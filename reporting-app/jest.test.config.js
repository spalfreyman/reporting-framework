process.env.ENABLE_NEW_JSX_TRANSFORM = 'true';

/**
 * @type {import('@jest/types').Config.ProjectConfig}
 */
module.exports = {
  preset: '@commercetools-frontend/jest-preset-mc-app/typescript',
  /**
   * ECharts and its renderer zrender ship as ESM, which Jest will not execute untransformed.
   * By default Jest ignores node_modules; this exception lets the preset's babel transform
   * compile just those two packages so chart renderers can be imported in tests.
   */
  transformIgnorePatterns: ['/node_modules/(?!(echarts|zrender)/)'],
};
