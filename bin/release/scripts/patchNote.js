// @ts-check

const fs = require('node:fs');
const moment = require('moment');
const { info, error, executeCmd } = require('./prompt');

// previous tag should be following rule:
//  v{major}.{minor}.{yyyymmdd}-[{channel}.]{ord}[internalMark]
const VERSION_REGEXP =
  /(?<major>\d+)\.(?<minor>\d+)\.(?<date>\d{8})-((?<channel>\w+)\.)?(?<ord>\d+)(?<internalMark>d)?/;

function parseVersion(tag) {
  const result = VERSION_REGEXP.exec(tag);
  if (result && result.groups) return result.groups;
  throw new Error(`cannot parse a given tag: ${tag}`);
}

/** @typedef {{ channel: 'stable' | 'unstable', environment: 'public' | 'internal' }} VersionContext */

/**
 * @param {string} tag
 * @returns {VersionContext}
 */
function getVersionContext(tag) {
  const result = parseVersion(tag);
  if (result.channel === 'stable') {
    throw new Error('stable channel must have no prefix');
  }

  const channel = result.channel || 'stable';
  const environment = result.internalMark ? 'internal' : 'public';

  if (channel !== 'stable' && channel !== 'unstable') {
    throw new Error(`invalid channel: ${channel}`);
  }

  return {
    channel,
    environment,
  };
}

/**
 * @param {VersionContext} a
 * @param {VersionContext} b
 */
function isSameVersionContext(a, b) {
  return a.channel === b.channel && a.environment === b.environment;
}

function validateVersionContext({ versionTag, releaseEnvironment, releaseChannel }) {
  const { channel, environment } = getVersionContext(versionTag);

  if (releaseChannel !== channel || releaseEnvironment !== environment) {
    throw new Error('invalid version context');
  }
}

function generateNewVersion({ previousVersion, now = Date.now() }) {
  const { major, minor, date, channel, ord, internalMark } = parseVersion(previousVersion);

  const today = moment(now).format('YYYYMMDD');
  const newOrd = date === today ? parseInt(ord, 10) + 1 : 1;
  const channelPrefix = channel ? `${channel}.` : '';
  return `${major}.${minor}.${today}-${channelPrefix}${newOrd}${internalMark || ''}`;
}

/**
 * @param {string | string[]} lines
 */
function splitToLines(lines) {
  if (typeof lines === 'string') {
    return lines.split(/\r?\n/g);
  }
  return lines;
}

function readPatchNoteFile(patchNoteFileName) {
  try {
    const lines = splitToLines(fs.readFileSync(patchNoteFileName, { encoding: 'utf8' }));
    const version = lines.shift();
    if (!version) {
      return null;
    }
    return {
      version,
      lines,
    };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return null;
  }
}

/**
 * @param {number | fs.PathLike} patchNoteFileName
 * @param {string} version
 * @param {string | string[]} contents
 */
function writePatchNoteFile(patchNoteFileName, version, contents) {
  const lines = splitToLines(contents);
  const body = [version, ...lines].join('\n');
  fs.writeFileSync(patchNoteFileName, body);
}

/**
 *
 * @param {string} previousVersion
 * @returns
 */
function gitLog(previousVersion) {
  return executeCmd(`git log --oneline --merges v${previousVersion}..`, { silent: true }).stdout;
}
function gitCurrentBranch() {
  return executeCmd('git rev-parse --abbrev-ref HEAD', { silent: true }).stdout.trim();
}

const branchMemo = new Map();
/**
 * @param {{octokit: import('@octokit/rest'); owner: string; repo: string}} param0
 * @param {string} branch
 * @returns {Promise<{data: {title: string; number: number; user: {login: string}; merge_commit_sha: string}[]}>}
 */
function gitHubGetPRFromBranch({ octokit, owner, repo }, branch) {
  const key = `${owner}/${repo}/${branch}`;
  if (branchMemo.has(key)) {
    return branchMemo.get(key);
  }
  const promise = octokit.pulls
    .list({ owner, repo })
    .then(r => ({ ...r, data: r.data.filter(pr => pr.head.ref === branch) }));
  branchMemo.set(key, promise);
  return promise;
}

/**
 * @param {{ octokit: import('@octokit/rest'); owner: string; repo: string }} param0
 * @param {string} previousVersion
 * @param {{ addAuthor: boolean }} param1
 */
async function collectPullRequestMerges({ octokit, owner, repo }, previousVersion, { addAuthor }) {
  const merges = gitLog(previousVersion);
  const currentBranch = gitCurrentBranch();
  const defaultBranch = await octokit.repos
    .get({ owner, repo })
    .then(({ data }) => data.default_branch);

  /**
   * @type {Promise<{title: string; number: number; user: string; merged: boolean}[]>[]}
   */
  const promises = [];
  const lines = merges.split(/\r?\n/);

  for (const line of lines) {
    const mergeBranch = line.match(/.* Merge branch '([\w-_/]*)' into ([\w-_/]*)/);
    if (mergeBranch && mergeBranch.length >= 3) {
      const [_, branch, into] = mergeBranch;
      if (into !== defaultBranch && into === currentBranch && branch !== defaultBranch) {
        console.log('branch check', { branch, into, defaultBranch, currentBranch }); // DEBUG
        // 検証リリースブランチなどで、まだメインブランチにマージされていないものは、PRがあるならその情報を取得する
        promises.push(
          gitHubGetPRFromBranch({ octokit, owner, repo }, branch).then(
            ({ data }) => {
              console.log('data', data); // DEBUG
              return data.map(pr => ({
                title: pr.title,
                number: pr.number,
                user: pr.user.login,
                merged: false,
              }));
            },
            e => {
              info(e);
              return [];
            },
          ),
        );
      }
    }
  }

  for (const line of lines) {
    const pr = line.match(/.*Merge pull request #([0-9]*).*/);
    if (!pr || pr.length < 2) {
      continue;
    }
    const pullNumber = parseInt(pr[1], 10);
    promises.push(
      octokit.pulls.get({ owner, repo, pull_number: pullNumber }).then(
        ({ data }) => {
          // TODO PRに対するPR は除外する
          return [{ title: data.title, number: data.number, user: data.user.login, merged: true }];
        },
        e => {
          info(e);
          return [];
        },
      ),
    );
  }

  /**
   * @param {string} line
   */
  function level(line) {
    if (line.startsWith('追加:')) {
      return 0;
    }
    if (line.startsWith('変更:')) {
      return 1;
    }
    if (line.startsWith('修正:')) {
      return 2;
    }
    if (line.startsWith('開発:')) {
      return 4;
    }
    return 3;
  }

  return Promise.all(promises).then(results => {
    console.log('results', results); // DEBUG
    const summary = [];
    // TODO 未マージに同一PR が複数あったら一つにする
    // TODO 未マージとマージ済みで同じPRがあったら、マージ済みだけを残す
    for (const result of results.flat()) {
      const { title, number, user, merged } = result;
      const elements = [title, `(#${number})`];
      if (addAuthor) {
        elements.push(`by ${user}`);
      }
      if (!merged) {
        elements.push('(未マージ)');
      }
      summary.push(elements.join(' ') + '\n');
    }

    summary.sort((a, b) => {
      const d = level(a) - level(b);
      if (d) {
        return d;
      }
      if (a < b) {
        return -1;
      }
      if (a === b) {
        return 0;
      }
      return 1;
    });

    return summary.join('');
  });
}

/**
 * @param {string} version
 * @param {string} title
 * @param {string} notes
 * @returns {string}
 */
function generateNotesTsContent(version, title, notes) {
  const patchNote = `import { IPatchNotes } from '.';

export const notes: IPatchNotes = {
  version: '${version}',
  title: '${title}',
  notes: [
${notes
  .trim()
  .split('\n')
  .map(s => `    ${JSON.stringify(s)},`)
  .join('\n')}
  ]
};
`;
  info(`patch-note: '${patchNote}'`);
  return patchNote;
}

/**
 *
 * @param {{title: string; version: string; notes: string; filePath: string}} param
 */
function updateNotesTs({ title, version, notes, filePath }) {
  const generatedPatchNote = generateNotesTsContent(title, version, notes);

  fs.writeFileSync(filePath, generatedPatchNote);
}

/**
 * @param {object} param0
 * @param {string} param0.patchNoteFileName
 * @returns {{version: string, notes: string}}
 */
function readPatchNote({ patchNoteFileName }) {
  const patchNote = readPatchNoteFile(patchNoteFileName);

  if (!patchNote) {
    error(`${patchNoteFileName} is absent. Generate it before release.`);
    throw new Error(`${patchNoteFileName} is absent.`);
  }

  return {
    version: patchNote.version,
    notes: patchNote.lines.join('\n'),
  };
}

module.exports = {
  parseVersion,
  getVersionContext,
  generateNewVersion,
  isSameVersionContext,
  validateVersionContext,
  readPatchNoteFile,
  writePatchNoteFile,
  collectPullRequestMerges,
  updateNotesTs,
  readPatchNote,
  generateNotesTsContent,
};
