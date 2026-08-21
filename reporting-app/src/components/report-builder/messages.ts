import { defineMessages } from 'react-intl';

export default defineMessages({
  title: { id: 'Reporting.builder.title', defaultMessage: 'Report builder' },
  subtitle: {
    id: 'Reporting.builder.subtitle',
    defaultMessage:
      'Build a report from the available metrics and data sources. Saved reports appear in the catalogue for everyone with access.',
  },
  reportId: { id: 'Reporting.builder.reportId', defaultMessage: 'Report id' },
  reportTitle: {
    id: 'Reporting.builder.reportTitle',
    defaultMessage: 'Report title',
  },
  category: { id: 'Reporting.builder.category', defaultMessage: 'Category' },
  granularity: {
    id: 'Reporting.builder.granularity',
    defaultMessage: 'Default granularity',
  },
  tiles: { id: 'Reporting.builder.tiles', defaultMessage: 'Tiles' },
  addTile: { id: 'Reporting.builder.addTile', defaultMessage: 'Add tile' },
  removeTile: { id: 'Reporting.builder.removeTile', defaultMessage: 'Remove' },
  tileTitle: {
    id: 'Reporting.builder.tileTitle',
    defaultMessage: 'Tile title',
  },
  chartType: { id: 'Reporting.builder.chartType', defaultMessage: 'Chart' },
  metrics: { id: 'Reporting.builder.metrics', defaultMessage: 'Metrics' },
  dimensions: {
    id: 'Reporting.builder.dimensions',
    defaultMessage: 'Break down by',
  },
  preview: { id: 'Reporting.builder.preview', defaultMessage: 'Preview' },
  save: { id: 'Reporting.builder.save', defaultMessage: 'Save report' },
  saved: {
    id: 'Reporting.builder.saved',
    defaultMessage: 'Report saved. It is now in the catalogue.',
  },
  cannotSave: {
    id: 'Reporting.builder.cannotSave',
    defaultMessage: 'Fix the problems below before saving.',
  },
  existing: {
    id: 'Reporting.builder.existing',
    defaultMessage: 'Your saved reports',
  },
  edit: { id: 'Reporting.builder.edit', defaultMessage: 'Edit' },
  delete: { id: 'Reporting.builder.delete', defaultMessage: 'Delete' },
  newReport: {
    id: 'Reporting.builder.newReport',
    defaultMessage: 'New report',
  },
  previewHint: {
    id: 'Reporting.builder.previewHint',
    defaultMessage:
      'Preview runs the draft through the gateway exactly as a saved report would.',
  },
});
