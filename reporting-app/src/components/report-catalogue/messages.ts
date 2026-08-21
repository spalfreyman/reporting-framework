import { defineMessages } from 'react-intl';

export default defineMessages({
  title: {
    id: 'Reporting.catalogue.title',
    defaultMessage: 'Report catalogue',
  },
  subtitle: {
    id: 'Reporting.catalogue.subtitle',
    defaultMessage:
      'Reports are framed by your permissions and by the data sources installed in this project.',
  },
  searchPlaceholder: {
    id: 'Reporting.catalogue.searchPlaceholder',
    defaultMessage: 'Search reports',
  },
  allCategories: {
    id: 'Reporting.catalogue.allCategories',
    defaultMessage: 'All categories',
  },
  noResults: {
    id: 'Reporting.catalogue.noResults',
    defaultMessage: 'No reports match your search.',
  },
  unavailable: {
    id: 'Reporting.catalogue.unavailable',
    defaultMessage: 'Needs a data source',
  },
  custom: { id: 'Reporting.catalogue.custom', defaultMessage: 'Custom' },
  installedSources: {
    id: 'Reporting.catalogue.installedSources',
    defaultMessage: 'Installed data sources: {sources}',
  },
  noSources: {
    id: 'Reporting.catalogue.noSources',
    defaultMessage:
      'No data sources are installed yet. Install a data-source connector and its reports will appear here automatically — no redeploy of this application is needed.',
  },
  categoryTrading: {
    id: 'Reporting.category.trading',
    defaultMessage: 'Trading and revenue',
  },
  categoryMerchandising: {
    id: 'Reporting.category.merchandising',
    defaultMessage: 'Merchandising and catalogue',
  },
  categoryCustomer: {
    id: 'Reporting.category.customer',
    defaultMessage: 'Customer and retention',
  },
  categoryMarketing: {
    id: 'Reporting.category.marketing',
    defaultMessage: 'Marketing and acquisition',
  },
  categoryPromotions: {
    id: 'Reporting.category.promotions',
    defaultMessage: 'Promotions and discounting',
  },
  categoryOperations: {
    id: 'Reporting.category.operations',
    defaultMessage: 'Operations and fulfilment',
  },
  categoryInventory: {
    id: 'Reporting.category.inventory',
    defaultMessage: 'Inventory and supply',
  },
});
