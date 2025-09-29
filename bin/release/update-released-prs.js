#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { Octokit } = require('@octokit/rest');
const { confirm, select } = require('@inquirer/prompts');
const colors = require('colors');

// コマンドライン引数の解析
function parseCommandLineArgs() {
  try {
    const { values, positionals } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          short: 'h',
          default: false
        },
        'no-comment': {
          type: 'boolean',
          default: false
        },
        'from-status': {
          type: 'string',
          default: 'To Be Released'
        },
        'to-status': {
          type: 'string',
          default: 'Released'
        }
      },
      allowPositionals: false
    });

    if (values.help) {
      console.log(`
${colors.bold('N Air Release PR Updater')}

${colors.blue('USAGE:')}
  node update-released-prs.js [OPTIONS]

${colors.blue('OPTIONS:')}
  -h, --help              Show this help message
  --no-comment            Skip adding release comments to PRs (default: false)
  --from-status <status>  Only update PRs with this status (default: "To Be Released")
  --to-status <status>    Move PRs to this status (default: "Released")

${colors.blue('ENVIRONMENT:')}
  UPDATE_PR_GITHUB_TOKEN  GitHub Personal Access Token with repo and project permissions
  DEBUG_FIELDS            Set to 1 to enable debug output

${colors.blue('EXAMPLES:')}
  node update-released-prs.js
  node update-released-prs.js --no-comment
  node update-released-prs.js --from-status "Doing for Release" --to-status "Released"
  node update-released-prs.js --to-status "Closed"
  DEBUG_FIELDS=1 node update-released-prs.js
      `);
      process.exit(0);
    }

    return {
      addComments: !values['no-comment'],
      fromStatus: values['from-status'],
      toStatus: values['to-status']
    };

  } catch (error) {
    console.error(colors.red(`Error parsing command line arguments: ${error.message}`));
    console.log(colors.yellow('Use --help for usage information'));
    process.exit(1);
  }
}

// 設定
const CONFIG = {
  // GitHub Project V2の設定
  ORG_NAME: 'n-air-app', // REPO_OWNERと同じ
  PROJECT_NUMBER: 3, // URLの番号 (https://github.com/orgs/n-air-app/projects/3/)
  REPO_NAME: 'n-air-app',
  STATUS_FIELD_NAME: 'Status',
  RELEASED_STATUS_NAME: 'Released', // ID: e2f66ca6

  // APIレート制限対策
  DELAY_MS: 100
};

class ReleaseUpdater {
  constructor(options = {}) {
    const token = process.env.UPDATE_PR_GITHUB_TOKEN;

    this.octokit = new Octokit({
      auth: token
    });

    // オプション設定
    this.options = {
      addComments: options.addComments !== false, // デフォルト: true
      fromStatus: options.fromStatus || 'To Be Released',
      toStatus: options.toStatus || 'Released'
    };

    this.projectId = null;
    this.statusFieldId = null;
    this.releasedOptionId = null;
    this.toStatusOptionId = null; // 動的に設定
    this.availableStatuses = []; // バリデーション用
    this.statusOptions = {}; // status name -> option id のマップ
  }

  async init() {
    if (!process.env.UPDATE_PR_GITHUB_TOKEN) {
      console.error(colors.red('Error: UPDATE_PR_GITHUB_TOKEN environment variable is required'));
      process.exit(1);
    }

    console.log(colors.blue('Initializing GitHub API connection...'));

    try {
      // GitHub APIの接続テスト
      const { data: user } = await this.octokit.rest.users.getAuthenticated();
      console.log(colors.green(`Connected as: ${user.login}`));

      // Project権限の確認
      await this.checkProjectPermissions();

      // Project情報を取得
      await this.initializeProjectInfo();

    } catch (error) {
      console.error(colors.red('Failed to initialize GitHub API:'), error.message);
      process.exit(1);
    }
  }

  async checkProjectPermissions() {
    console.log(colors.blue('Checking Project V2 permissions...'));

    try {
      // Organizationへのアクセス権限確認
      const orgQuery = `
        query($org: String!) {
          organization(login: $org) {
            id
            login
          }
        }
      `;

      await this.octokit.graphql(orgQuery, { org: CONFIG.ORG_NAME });

      // Project V2への基本アクセス権限確認
      const projectQuery = `
        query($org: String!, $number: Int!) {
          organization(login: $org) {
            projectV2(number: $number) {
              id
              title
            }
          }
        }
      `;

      const response = await this.octokit.graphql(projectQuery, {
        org: CONFIG.ORG_NAME,
        number: CONFIG.PROJECT_NUMBER
      });

      if (!response.organization?.projectV2) {
        throw new Error(`Project #${CONFIG.PROJECT_NUMBER} not found or insufficient permissions`);
      }

      console.log(colors.green(`✓ Project access confirmed: ${response.organization.projectV2.title}`));

    } catch (error) {
      if (error.message.includes('Must have admin rights to Repository')) {
        console.error(colors.red('Error: Token requires admin rights to the repository'));
      } else if (error.message.includes('insufficient')) {
        console.error(colors.red('Error: Token has insufficient permissions for Project V2'));
      } else {
        console.error(colors.red(`Permission check failed: ${error.message}`));
      }
      console.log(colors.yellow('Required UPDATE_PR_GITHUB_TOKEN permissions:'));
      console.log(colors.yellow('  - repo (for PR comments)'));
      console.log(colors.yellow('  - project:read (for reading project data)'));
      console.log(colors.yellow('  - project:write (for updating project items)'));
      throw error;
    }
  }

  async validateOptions() {
    console.log(colors.blue('Validating options...'));

    // fromStatusの検証
    if (!this.availableStatuses.includes(this.options.fromStatus)) {
      console.error(colors.red(`Error: Invalid --from-status "${this.options.fromStatus}"`));
      console.log(colors.yellow('Available statuses:'));
      this.availableStatuses.forEach(status => {
        console.log(colors.yellow(`  - "${status}"`));
      });
      throw new Error(`Invalid status: ${this.options.fromStatus}`);
    }

    // toStatusの検証
    if (!this.availableStatuses.includes(this.options.toStatus)) {
      console.error(colors.red(`Error: Invalid --to-status "${this.options.toStatus}"`));
      console.log(colors.yellow('Available statuses:'));
      this.availableStatuses.forEach(status => {
        console.log(colors.yellow(`  - "${status}"`));
      });
      throw new Error(`Invalid status: ${this.options.toStatus}`);
    }

    console.log(colors.green(`✓ Options validated`));
    console.log(colors.gray(`  Add comments: ${this.options.addComments}`));
    console.log(colors.gray(`  From status: "${this.options.fromStatus}"`));
    console.log(colors.gray(`  To status: "${this.options.toStatus}"`));
  }

  async initializeProjectInfo() {
    console.log(colors.blue('Fetching Project V2 information...'));

    try {
      // Project IDを取得
      this.projectId = await this.getProjectId(CONFIG.ORG_NAME, CONFIG.PROJECT_NUMBER);
      console.log(colors.green(`Project ID: ${this.projectId}`));

      // Project のフィールド情報を取得
      const { statusFieldId, releasedOptionId, availableStatuses, statusOptions } = await this.getProjectFields(this.projectId);
      this.statusFieldId = statusFieldId;
      this.releasedOptionId = releasedOptionId;
      this.availableStatuses = availableStatuses;
      this.statusOptions = statusOptions;

      // toStatusのオプションIDを設定
      this.toStatusOptionId = this.statusOptions[this.options.toStatus];

      console.log(colors.green(`Status Field ID: ${this.statusFieldId}`));
      console.log(colors.green(`Released Option ID: ${this.releasedOptionId}`));

      // fromStatusオプションのバリデーション
      await this.validateOptions();

      // デバッグ: 全フィールドを表示
      if (process.env.DEBUG_FIELDS) {
        await this.debugProjectFields(this.projectId);
      }

    } catch (error) {
      console.error(colors.red('Failed to initialize project information:'), error.message);
      throw error;
    }
  }

  async getProjectId(orgName, projectNumber) {
    const query = `
      query($org: String!, $number: Int!) {
        organization(login: $org) {
          projectV2(number: $number) {
            id
            title
          }
        }
      }
    `;

    try {
      const response = await this.octokit.graphql(query, {
        org: orgName,
        number: projectNumber
      });

      if (!response.organization?.projectV2) {
        throw new Error(`Project #${projectNumber} not found in organization ${orgName}`);
      }

      return response.organization.projectV2.id;
    } catch (error) {
      throw new Error(`Failed to get project ID: ${error.message}`);
    }
  }

  async debugProjectFields(projectId) {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 20) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  dataType
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await this.octokit.graphql(query, { projectId });

      console.log(colors.yellow('Debug: All project fields:'));
      response.node.fields.nodes.forEach(field => {
        console.log(colors.gray(`  Field: "${field.name}" (${field.dataType || 'unknown type'})`));
        if (field.options) {
          field.options.forEach(option => {
            console.log(colors.gray(`    Option: "${option.name}" (ID: ${option.id})`));
          });
        }
      });
    } catch (error) {
      console.warn(colors.yellow(`Warning: Could not debug project fields: ${error.message}`));
    }
  }

  async getProjectFields(projectId) {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 20) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await this.octokit.graphql(query, { projectId });

      if (!response.node?.fields?.nodes) {
        throw new Error('Project fields not found');
      }

      const fields = response.node.fields.nodes;
      const statusField = fields.find(field =>
        field.name === CONFIG.STATUS_FIELD_NAME && field.options
      );

      if (!statusField) {
        throw new Error(`Status field "${CONFIG.STATUS_FIELD_NAME}" not found`);
      }

      const releasedOption = statusField.options.find(option =>
        option.name === CONFIG.RELEASED_STATUS_NAME
      );

      if (!releasedOption) {
        throw new Error(`Status option "${CONFIG.RELEASED_STATUS_NAME}" not found`);
      }

      // ステータスオプションのマップを作成
      const statusOptions = {};
      statusField.options.forEach(option => {
        statusOptions[option.name] = option.id;
      });

      return {
        statusFieldId: statusField.id,
        releasedOptionId: releasedOption.id,
        availableStatuses: statusField.options.map(option => option.name),
        statusOptions
      };
    } catch (error) {
      throw new Error(`Failed to get project fields: ${error.message}`);
    }
  }

  parsePatchNote() {
    // プロジェクトルートを取得（binディレクトリから実行される場合を考慮）
    const currentDir = process.cwd();
    const projectRoot = currentDir.endsWith('/bin') || currentDir.endsWith('\\bin')
      ? path.dirname(currentDir)
      : currentDir;

    const patchNotePath = path.join(projectRoot, 'patch-note.txt');

    if (!fs.existsSync(patchNotePath)) {
      throw new Error(`patch-note.txt not found in project root (${projectRoot})`);
    }

    const content = fs.readFileSync(patchNotePath, 'utf-8');
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);

    if (lines.length === 0) {
      throw new Error('patch-note.txt is empty');
    }

    const version = lines[0];
    const prNumbers = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/\(#(\d+)\)/);
      if (match) {
        prNumbers.push(parseInt(match[1], 10));
      }
    }

    if (prNumbers.length === 0) {
      console.log(colors.yellow('Debug: Lines found in patch-note.txt:'));
      lines.forEach((line, index) => {
        console.log(colors.gray(`  ${index}: ${line}`));
      });
    }

    return { version, prNumbers };
  }

  async getPRInfo(prNumber) {
    try {
      const { data: pr } = await this.octokit.rest.pulls.get({
        owner: CONFIG.ORG_NAME,
        repo: CONFIG.REPO_NAME,
        pull_number: prNumber
      });

      return {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state: pr.state,
        merged: pr.merged,
        author: pr.user?.login
      };
    } catch (error) {
      console.warn(colors.yellow(`Warning: Could not fetch PR #${prNumber}: ${error.message}`));
      return null;
    }
  }

  async checkExistingReleaseComment(prNumber, version) {
    try {
      const { data: comments } = await this.octokit.rest.issues.listComments({
        owner: CONFIG.ORG_NAME,
        repo: CONFIG.REPO_NAME,
        issue_number: prNumber
      });

      return comments.some(comment =>
        comment.body && comment.body.includes(`Released in ${version}`)
      );
    } catch (error) {
      console.warn(colors.yellow(`Warning: Could not check comments for PR #${prNumber}: ${error.message}`));
      return false;
    }
  }

  async getAllPRData(prNumbers, version) {
    const query = `
      query($owner: String!, $repo: String!, $projectId: ID!) {
        repository(owner: $owner, name: $repo) {
          pullRequests(first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
            nodes {
              number
              title
              url
              state
              merged
              author {
                login
              }
              comments(first: 100) {
                nodes {
                  body
                }
              }
            }
          }
        }
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100) {
              nodes {
                id
                content {
                  ... on PullRequest {
                    number
                    repository {
                      owner {
                        login
                      }
                      name
                    }
                  }
                }
                fieldValues(first: 20) {
                  nodes {
                    __typename
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field {
                        ... on ProjectV2SingleSelectField {
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await this.octokit.graphql(query, {
        owner: CONFIG.ORG_NAME,
        repo: CONFIG.REPO_NAME,
        projectId: this.projectId
      });

      const prsData = response.repository?.pullRequests?.nodes || [];
      const projectItems = response.node?.items?.nodes || [];

      // デバッグ: 取得したPR番号を表示
      if (process.env.DEBUG_FIELDS) {
        console.log(colors.yellow('Debug: Found PRs in repository:'));
        prsData.forEach(pr => {
          console.log(colors.gray(`  PR #${pr.number}: ${pr.title} (${pr.state})`));
        });
      }

      // PRごとにデータを組み立て
      return prNumbers.map(prNumber => {
        // PR基本情報を取得
        const prInfo = prsData.find(pr => pr.number === prNumber);
        if (!prInfo) {
          return {
            prNumber,
            error: 'PR not found in repository (may need to increase query limit or PR is very old)'
          };
        }

        // コメント確認
        const hasComment = prInfo.comments.nodes.some(comment =>
          comment.body && comment.body.includes(`Released in ${version}`)
        );

        // プロジェクトアイテムを検索
        const projectItem = projectItems.find(item => {
          return item.content?.number === prNumber &&
                 item.content?.repository?.owner?.login === CONFIG.ORG_NAME &&
                 item.content?.repository?.name === CONFIG.REPO_NAME;
        });

        let currentStatus = null;
        let projectItemId = null;

        if (projectItem) {
          projectItemId = projectItem.id;

          // ステータスフィールドを検索
          const statusField = projectItem.fieldValues.nodes.find(fieldValue =>
            fieldValue.field?.name === CONFIG.STATUS_FIELD_NAME &&
            fieldValue.__typename === 'ProjectV2ItemFieldSingleSelectValue'
          );

          currentStatus = statusField?.name || null;

          // デバッグ情報
          if (process.env.DEBUG_FIELDS) {
            console.log(colors.yellow(`Debug: PR #${prNumber} field values:`));
            projectItem.fieldValues.nodes.forEach(fieldValue => {
              const fieldName = fieldValue.field?.name || 'unknown';
              const fieldType = fieldValue.__typename || 'unknown';
              const value = fieldValue.name || 'null';
              console.log(colors.gray(`  ${fieldType}: "${fieldName}" = "${value}"`));
            });
          }
        }

        return {
          prNumber,
          prInfo: {
            number: prInfo.number,
            title: prInfo.title,
            url: prInfo.url,
            state: prInfo.state,
            merged: prInfo.merged,
            author: prInfo.author?.login
          },
          hasComment,
          currentStatus,
          projectItemId
        };
      });

    } catch (error) {
      console.error(colors.red(`Failed to fetch PR data: ${error.message}`));

      // エラー時は個別取得にフォールバック
      console.log(colors.yellow('Falling back to individual API calls...'));
      return this.getAllPRDataFallback(prNumbers, version);
    }
  }

  async getAllPRDataHybrid(prNumbers, version) {
    // ハイブリッド方式: プロジェクト情報は一括取得、PR情報は個別取得
    console.log(colors.blue('Fetching project information...'));

    const projectQuery = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100) {
              nodes {
                id
                content {
                  ... on PullRequest {
                    number
                    repository {
                      owner {
                        login
                      }
                      name
                    }
                  }
                }
                fieldValues(first: 20) {
                  nodes {
                    __typename
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field {
                        ... on ProjectV2SingleSelectField {
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const projectResponse = await this.octokit.graphql(projectQuery, {
        projectId: this.projectId
      });

      const projectItems = projectResponse.node?.items?.nodes || [];

      // デバッグ: プロジェクトアイテムを表示
      if (process.env.DEBUG_FIELDS || projectItems.length === 0) {
        console.log(colors.yellow(`Debug: Found ${projectItems.length} items in project:`));
        projectItems.forEach(item => {
          if (item.content?.number) {
            console.log(colors.gray(`  Project Item: PR #${item.content.number}`));
          }
        });
      }

      console.log(colors.blue('Fetching individual PR information...'));

      const results = [];
      for (let i = 0; i < prNumbers.length; i++) {
        const prNumber = prNumbers[i];
        console.log(colors.gray(`  Getting PR #${prNumber} (${i + 1}/${prNumbers.length})...`));

        try {
          // 個別にPR情報を取得
          const prInfo = await this.getPRInfo(prNumber);
          if (!prInfo) {
            results.push({
              prNumber,
              error: 'Could not fetch PR information'
            });
            continue;
          }

          // コメント確認
          const hasComment = await this.checkExistingReleaseComment(prNumber, version);

          // プロジェクトアイテムを検索
          const projectItem = projectItems.find(item => {
            return item.content?.number === prNumber &&
                   item.content?.repository?.owner?.login === CONFIG.ORG_NAME &&
                   item.content?.repository?.name === CONFIG.REPO_NAME;
          });

          let currentStatus = null;
          let projectItemId = null;

          if (projectItem) {
            projectItemId = projectItem.id;

            // ステータスフィールドを検索
            const statusField = projectItem.fieldValues.nodes.find(fieldValue =>
              fieldValue.field?.name === CONFIG.STATUS_FIELD_NAME &&
              fieldValue.__typename === 'ProjectV2ItemFieldSingleSelectValue'
            );

            currentStatus = statusField?.name || null;

            // デバッグ情報
            if (process.env.DEBUG_FIELDS) {
              console.log(colors.yellow(`    Debug: PR #${prNumber} field values:`));
              projectItem.fieldValues.nodes.forEach(fieldValue => {
                const fieldName = fieldValue.field?.name || 'unknown';
                const fieldType = fieldValue.__typename || 'unknown';
                const value = fieldValue.name || 'null';
                console.log(colors.gray(`      ${fieldType}: "${fieldName}" = "${value}"`));
              });
            }
          }

          results.push({
            prNumber,
            prInfo,
            hasComment,
            currentStatus,
            projectItemId
          });

        } catch (error) {
          results.push({
            prNumber,
            error: error.message
          });
        }

        // API rate limit対策
        await new Promise((resolve) => {
          setTimeout(resolve, 50); // 短縮
        });
      }

      return results;

    } catch (error) {
      console.error(colors.red(`Failed to fetch project data: ${error.message}`));
      return this.getAllPRDataFallback(prNumbers, version);
    }
  }

  async getAllPRDataIndividual(prNumbers, version) {
    const results = [];

    for (let i = 0; i < prNumbers.length; i++) {
      const prNumber = prNumbers[i];
      console.log(colors.blue(`Processing PR #${prNumber} (${i + 1}/${prNumbers.length})...`));

      try {
        // PR基本情報を取得
        const prInfo = await this.getPRInfo(prNumber);
        if (!prInfo) {
          results.push({
            prNumber,
            error: 'Could not fetch PR information'
          });
          continue;
        }

        // コメント確認
        const hasComment = await this.checkExistingReleaseComment(prNumber, version);

        // プロジェクトアイテムを検索（個別に）
        const projectItemId = await this.findProjectItemIndividual(prNumber);
        let currentStatus = null;

        if (projectItemId) {
          currentStatus = await this.getProjectItemStatus(projectItemId);
        }

        results.push({
          prNumber,
          prInfo,
          hasComment,
          currentStatus,
          projectItemId
        });

      } catch (error) {
        results.push({
          prNumber,
          error: error.message
        });
      }

      // API rate limit対策
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }

    return results;
  }

  async getAllPRDataFallback(prNumbers, version) {
    const results = [];

    for (let i = 0; i < prNumbers.length; i++) {
      const prNumber = prNumbers[i];
      console.log(colors.blue(`Analyzing PR #${prNumber} (${i + 1}/${prNumbers.length})...`));

      try {
        const prInfo = await this.getPRInfo(prNumber);
        if (!prInfo) {
          results.push({
            prNumber,
            error: 'Could not fetch PR information'
          });
          continue;
        }

        const hasComment = await this.checkExistingReleaseComment(prNumber, version);
        const currentStatus = await this.getCurrentProjectStatus(prNumber);
        const projectItemId = await this.findProjectItem(prNumber);

        results.push({
          prNumber,
          prInfo,
          hasComment,
          currentStatus,
          projectItemId
        });

        // API rate limit対策
        await new Promise((resolve) => {
          setTimeout(resolve, CONFIG.DELAY_MS);
        });

      } catch (error) {
        results.push({
          prNumber,
          error: error.message
        });
      }
    }

    return results;
  }

  async getCurrentProjectStatus(prNumber) {
    try {
      const itemId = await this.findProjectItem(prNumber);
      if (!itemId) {
        return null; // Project item not found
      }

      const query = `
        query($itemId: ID!) {
          node(id: $itemId) {
            ... on ProjectV2Item {
              fieldValues(first: 20) {
                nodes {
                  __typename
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      ... on ProjectV2SingleSelectField {
                        name
                      }
                    }
                  }
                  ... on ProjectV2ItemFieldTextValue {
                    text
                    field {
                      ... on ProjectV2Field {
                        name
                      }
                    }
                  }
                  ... on ProjectV2ItemFieldLabelValue {
                    labels(first: 10) {
                      nodes {
                        name
                      }
                    }
                    field {
                      ... on ProjectV2Field {
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const response = await this.octokit.graphql(query, { itemId });

      if (!response.node?.fieldValues?.nodes) {
        return null;
      }

      // デバッグ: 全フィールドを表示
      if (process.env.DEBUG_FIELDS) {
        console.log(colors.yellow(`Debug: All field values for PR #${prNumber}:`));
        response.node.fieldValues.nodes.forEach(fieldValue => {
          const fieldName = fieldValue.field?.name || 'unknown';
          const fieldType = fieldValue.__typename || 'unknown';
          let value = 'null';

          if (fieldValue.name) value = fieldValue.name;
          else if (fieldValue.text) value = fieldValue.text;
          else if (fieldValue.labels) value = fieldValue.labels.nodes.map(l => l.name).join(', ');

          console.log(colors.gray(`  ${fieldType}: "${fieldName}" = "${value}"`));
        });
      }

      // まず設定された STATUS_FIELD_NAME で検索
      let statusField = response.node.fieldValues.nodes.find(fieldValue =>
        fieldValue.field?.name === CONFIG.STATUS_FIELD_NAME
      );

      // 見つからない場合、一般的なステータスフィールド名で検索
      if (!statusField) {
        const commonStatusNames = ['Status', 'State', 'Column', 'Phase', 'Stage'];
        for (const statusName of commonStatusNames) {
          statusField = response.node.fieldValues.nodes.find(fieldValue =>
            fieldValue.field?.name === statusName
          );
          if (statusField) {
            console.log(colors.yellow(`Info: Found status field with name "${statusName}" instead of "${CONFIG.STATUS_FIELD_NAME}"`));
            break;
          }
        }
      }

      return statusField?.name || null;
    } catch (error) {
      console.warn(colors.yellow(`Warning: Could not get current status for PR #${prNumber}: ${error.message}`));
      return null;
    }
  }

  async displayExecutionPlan(version, prNumbers) {
    console.log(colors.bold.blue('\\n=== EXECUTION PLAN ==='));
    console.log(colors.blue(`Release Version: ${version}`));
    console.log(colors.blue(`Target PRs: ${prNumbers.length}`));
    console.log('');

    // 全PRの情報を一件ずつ確実に取得
    console.log(colors.blue('Fetching PR information individually...'));
    const allPRData = await this.getAllPRDataIndividual(prNumbers, version);

    const actions = [];

    for (const prData of allPRData) {
      if (prData.error) {
        console.log(colors.red(`PR #${prData.prNumber}: ✗ ${prData.error}`));
        actions.push({
          prNumber: prData.prNumber,
          error: prData.error,
          skip: true
        });
        continue;
      }

      console.log(colors.blue(`PR #${prData.prNumber}: ${prData.prInfo.title}`));
      console.log(colors.gray(`  Author: ${prData.prInfo.author}, State: ${prData.prInfo.state}, Merged: ${prData.prInfo.merged}`));

      // Statusに応じて色分け
      const status = prData.currentStatus || 'Not in Project';
      let coloredStatus;

      if (status === 'Not in Project') {
        coloredStatus = colors.red(status);
      } else if (status === 'To Be Released') {
        coloredStatus = colors.green(status);
      } else if (status === CONFIG.RELEASED_STATUS_NAME) {
        coloredStatus = colors.blue(status);
      } else {
        coloredStatus = colors.yellow(status);
      }

      console.log(`  Current Status: ${coloredStatus}`);

      // オプションによるフィルタリング
      const shouldProcess = prData.currentStatus === this.options.fromStatus;

      if (!shouldProcess) {
        console.log(colors.gray(`  Skipping: Current status "${prData.currentStatus || 'Not in Project'}" != target "${this.options.fromStatus}"`));
        return; // このPRはスキップ
      }

      const plannedActions = [];

      // コメント追加のプラン
      if (this.options.addComments) {
        if (prData.hasComment) {
          plannedActions.push(colors.gray('✓ Release comment (already exists)'));
        } else {
          plannedActions.push(colors.green('+ Add release comment'));
        }
      } else {
        plannedActions.push(colors.gray('- Skip release comment (--no-comment)'));
      }

      // ステータス更新のプラン
      if (prData.currentStatus === this.options.toStatus) {
        plannedActions.push(colors.gray(`✓ Project status (already ${this.options.toStatus})`));
      } else {
        plannedActions.push(colors.green(`+ Move to ${this.options.toStatus} status (from ${prData.currentStatus || 'Not in Project'})`));
      }

      actions.push({
        prNumber: prData.prNumber,
        prInfo: prData.prInfo,
        hasComment: prData.hasComment,
        currentStatus: prData.currentStatus,
        projectItemId: prData.projectItemId,
        actions: plannedActions
      });
    }

    // 実行計画を表示
    for (const action of actions) {
      if (action.error) {
        console.log(colors.red(`PR #${action.prNumber}: ${action.error}`));
        continue;
      }

      console.log(colors.bold(`PR #${action.prNumber}: ${action.prInfo.title}`));
      console.log(colors.gray(`  Author: ${action.prInfo.author}, State: ${action.prInfo.state}, Merged: ${action.prInfo.merged}`));
      console.log(colors.gray(`  URL: ${action.prInfo.url}`));

      // Statusの色分け表示
      const status = action.currentStatus || 'Not in Project';
      let coloredStatus;

      if (status === 'Not in Project') {
        coloredStatus = colors.red(status);
      } else if (status === 'To Be Released') {
        coloredStatus = colors.green(status);
      } else if (status === CONFIG.RELEASED_STATUS_NAME) {
        coloredStatus = colors.blue(status);
      } else {
        coloredStatus = colors.yellow(status);
      }

      console.log(`  Current Status: ${coloredStatus}`);

      for (const actionDesc of action.actions) {
        console.log(`  ${actionDesc}`);
      }
      console.log('');
    }

    return actions;
  }

  async addReleaseComment(prNumber, version) {
    const commentBody = `🎉 Released in ${version}

This PR has been included in the release. Thank you for your contribution!`;

    try {
      await this.octokit.rest.issues.createComment({
        owner: CONFIG.ORG_NAME,
        repo: CONFIG.REPO_NAME,
        issue_number: prNumber,
        body: commentBody
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async updateProjectStatus(prNumber, itemId = null) {
    try {
      // itemIdが渡されていない場合は検索
      const projectItemId = itemId || await this.findProjectItem(prNumber);
      if (!projectItemId) {
        return { success: false, error: `Project item not found for PR #${prNumber}` };
      }

      // ステータスフィールドを更新
      await this.updateProjectItemStatus(projectItemId);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async findProjectItemIndividual(prNumber) {
    // 個別にPRを検索するより確実な方法
    const query = `
      query($owner: String!, $repo: String!, $prNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $prNumber) {
            projectItems(first: 10) {
              nodes {
                id
                project {
                  id
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await this.octokit.graphql(query, {
        owner: CONFIG.ORG_NAME,
        repo: CONFIG.REPO_NAME,
        prNumber
      });

      const pr = response.repository?.pullRequest;
      if (!pr?.projectItems?.nodes) {
        return null;
      }

      // 対象プロジェクトのアイテムを検索
      const targetItem = pr.projectItems.nodes.find(item =>
        item.project?.id === this.projectId
      );

      if (process.env.DEBUG_FIELDS) {
        console.log(colors.yellow(`Debug: PR #${prNumber} has ${pr.projectItems.nodes.length} project items`));
        pr.projectItems.nodes.forEach(item => {
          console.log(colors.gray(`  Project Item: ${item.id} (Project: ${item.project?.id})`));
        });
        if (targetItem) {
          console.log(colors.green(`  Found target item: ${targetItem.id}`));
        } else {
          console.log(colors.yellow(`  No item found for project ${this.projectId}`));
        }
      }

      return targetItem?.id || null;

    } catch (error) {
      if (process.env.DEBUG_FIELDS) {
        console.log(colors.yellow(`Debug: Failed to find project item for PR #${prNumber}: ${error.message}`));
      }
      return null;
    }
  }

  async getProjectItemStatus(itemId) {
    const query = `
      query($itemId: ID!) {
        node(id: $itemId) {
          ... on ProjectV2Item {
            fieldValues(first: 10) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field {
                    ... on ProjectV2SingleSelectField {
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await this.octokit.graphql(query, { itemId });

      if (!response.node?.fieldValues?.nodes) {
        return null;
      }

      const statusField = response.node.fieldValues.nodes.find(fieldValue =>
        fieldValue.field?.name === CONFIG.STATUS_FIELD_NAME
      );

      return statusField?.name || null;

    } catch (error) {
      if (process.env.DEBUG_FIELDS) {
        console.log(colors.yellow(`Debug: Failed to get status for item ${itemId}: ${error.message}`));
      }
      return null;
    }
  }

  async findProjectItem(prNumber) {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100) {
              nodes {
                id
                content {
                  ... on PullRequest {
                    number
                    repository {
                      owner {
                        login
                      }
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await this.octokit.graphql(query, {
        projectId: this.projectId
      });

      if (!response.node?.items?.nodes) {
        if (process.env.DEBUG_FIELDS) {
          console.log(colors.yellow(`Debug: No project items found for search`));
        }
        return null;
      }

      const items = response.node.items.nodes;

      // デバッグ: 検索対象のアイテムを表示
      if (process.env.DEBUG_FIELDS) {
        console.log(colors.yellow(`Debug: Searching for PR #${prNumber} in ${items.length} project items`));
        items.slice(0, 5).forEach(item => {
          if (item.content?.number) {
            console.log(colors.gray(`  Available: PR #${item.content.number}`));
          }
        });
      }

      const targetItem = items.find(item => {
        if (!item.content) {
          return false;
        }

        return item.content.number === prNumber &&
               item.content.repository?.owner?.login === CONFIG.ORG_NAME &&
               item.content.repository?.name === CONFIG.REPO_NAME;
      });

      if (!targetItem && process.env.DEBUG_FIELDS) {
        console.log(colors.yellow(`Debug: PR #${prNumber} not found in first 100 project items`));
      }

      return targetItem?.id || null;
    } catch (error) {
      console.warn(colors.yellow(`Warning: Failed to find project item for PR #${prNumber}: ${error.message}`));
      return null;
    }
  }

  async updateProjectItemStatus(itemId) {
    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: {
              singleSelectOptionId: $optionId
            }
          }
        ) {
          projectV2Item {
            id
          }
        }
      }
    `;

    try {
      await this.octokit.graphql(mutation, {
        projectId: this.projectId,
        itemId,
        fieldId: this.statusFieldId,
        optionId: this.toStatusOptionId // 動的に設定されたtoStatusを使用
      });
    } catch (error) {
      throw new Error(`Failed to update project item status: ${error.message}`);
    }
  }

  async executeUpdates(actions, version) {
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const action of actions) {
      if (action.error || action.skip) {
        console.log(colors.gray(`Skipping PR #${action.prNumber}: ${action.error || 'Skipped'}`));
        skippedCount++;
        continue;
      }

      console.log(colors.blue(`Processing PR #${action.prNumber}...`));

      let actionTaken = false;

      // コメント追加
      if (this.options.addComments) {
        if (!action.hasComment) {
          const commentResult = await this.addReleaseComment(action.prNumber, version);
          if (commentResult.success) {
            console.log(colors.green(`  ✓ Added release comment`));
            actionTaken = true;
          } else {
            console.log(colors.red(`  ✗ Failed to add comment: ${commentResult.error}`));

            const continueOnError = await confirm({
              message: 'Continue with remaining PRs?',
              default: true
            });

            if (!continueOnError) {
              console.log(colors.yellow('Operation cancelled by user'));
              break;
            }
            errorCount++;
            continue;
          }
        } else {
          console.log(colors.gray(`  - Release comment already exists`));
        }
      } else {
        console.log(colors.gray(`  - Skipping release comment (--no-comment)`));
      }

      // Project ステータス更新
      if (action.currentStatus !== this.options.toStatus) {
        if (action.projectItemId) {
          const projectResult = await this.updateProjectStatus(action.prNumber, action.projectItemId);
          if (projectResult.success) {
            console.log(colors.green(`  ✓ Updated project status to ${this.options.toStatus}`));
            actionTaken = true;
          } else {
            console.log(colors.red(`  ✗ Failed to update project: ${projectResult.error || 'Unknown error'}`));

            const continueOnError = await confirm({
              message: 'Continue with remaining PRs?',
              default: true
            });

            if (!continueOnError) {
              console.log(colors.yellow('Operation cancelled by user'));
              break;
            }
            errorCount++;
            continue;
          }
        } else {
          console.log(colors.gray(`  - PR not found in project, skipping status update`));
        }
      } else {
        console.log(colors.gray(`  - Project status already ${this.options.toStatus}`));
      }

      if (actionTaken) {
        successCount++;
      } else {
        skippedCount++;
      }

      // API rate limit対策
      await new Promise((resolve) => {
        setTimeout(resolve, CONFIG.DELAY_MS);
      });
    }

    console.log(colors.bold.blue('\\n=== SUMMARY ==='));
    console.log(colors.green(`Successfully processed: ${successCount} PRs`));
    if (skippedCount > 0) {
      console.log(colors.gray(`Skipped (already up-to-date): ${skippedCount} PRs`));
    }
    if (errorCount > 0) {
      console.log(colors.red(`Errors encountered: ${errorCount} PRs`));
    }
  }

  async run() {
    try {
      console.log(colors.bold.blue('N Air Release PR Updater'));
      console.log(colors.gray('Updates PRs with release information and moves them to Released status'));
      console.log('');

      await this.init();

      // patch-note.txt を解析
      const { version, prNumbers } = this.parsePatchNote();

      if (prNumbers.length === 0) {
        console.log(colors.yellow('No PR numbers found in patch-note.txt'));
        return;
      }

      // 実行計画を表示
      const actions = await this.displayExecutionPlan(version, prNumbers);

      // 確認プロンプト
      console.log(colors.bold.yellow('⚠️  This will make changes to GitHub PRs and Projects!'));
      const proceed = await confirm({
        message: `Proceed with updating ${prNumbers.length} PRs?`,
        default: false
      });

      if (!proceed) {
        console.log(colors.yellow('Operation cancelled by user'));
        return;
      }

      // 実行
      await this.executeUpdates(actions, version);

    } catch (error) {
      console.error(colors.red('Error:'), error.message);
      process.exit(1);
    }
  }
}

// スクリプト実行
if (require.main === module) {
  const options = parseCommandLineArgs();
  const updater = new ReleaseUpdater(options);
  updater.run().catch(error => {
    console.error(colors.red('Unhandled error:'), error);
    process.exit(1);
  });
}

module.exports = ReleaseUpdater;