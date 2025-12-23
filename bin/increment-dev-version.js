// @ts-check

const fs = require('node:fs');
const path = require('node:path');
const { parseVersion, generateNewVersion } = require('./release/scripts/patchNote');

function main() {
  // 1. package.jsonを読み込み
  const projectRoot = path.resolve(__dirname, '..');
  const packageJsonPath = path.resolve(projectRoot, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('package.json not found');
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const currentVersion = packageJson.version;

  console.log(`Current version: ${currentVersion}`);

  // 2. devチャネルかチェック
  const parsed = parseVersion(currentVersion);
  if (parsed.channel !== 'dev') {
    throw new Error(`This script is only for dev channel. Current: ${parsed.channel || 'stable'}`);
  }

  // 3. 新バージョン生成（日付自動リセット）
  const newVersion = generateNewVersion({ previousVersion: currentVersion });
  console.log(`New version: ${newVersion}`);

  // 4. package.jsonを更新
  packageJson.version = newVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');

  // 5. 成功メッセージ（npm versionと同じフォーマット）
  console.log(`v${newVersion}`);
}

try {
  main();
} catch (err) {
  console.error('ERROR:', err.message);
  process.exit(1);
}
