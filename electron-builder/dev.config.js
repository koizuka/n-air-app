const config = require('./stable.config.js');

config.appId = 'jp.nicovideo.nair-dev';
config.productName = 'N Air dev版';
config.extraMetadata.name = 'n-air-dev';
config.extraMetadata.buildProductName = config.productName;
delete config.publish;
config.nsis.oneClick = true;

module.exports = config;
