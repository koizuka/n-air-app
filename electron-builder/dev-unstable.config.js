const config = require('./unstable.config.js');

config.productName += '(dev)';
delete config.publish;
delete config.win;
config.extraMetadata.buildProductName = config.productName;

// devテスト用にワンクリックインストール動作にする
config.nsis.oneClick = true;
config.nsis.allowToChangeInstallationDirectory = false;
delete config.nsis.license;

module.exports = config;
