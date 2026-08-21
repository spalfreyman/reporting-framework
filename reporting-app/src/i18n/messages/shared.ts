import { defineMessages } from 'react-intl';

/**
 * Metric and dimension labels, keyed off the canonical ids in `shared/semantic`.
 *
 * One label per metric, used by axis titles, legends, table headers, tooltips and KPI tiles
 * alike. Defining them once here is what stops the same metric being called three different
 * things in three different tiles.
 */
export const metricMessages = defineMessages({
  'metric.orders': { id: 'Reporting.metric.orders', defaultMessage: 'Orders' },
  'metric.revenueGross': {
    id: 'Reporting.metric.revenueGross',
    defaultMessage: 'Gross revenue',
  },
  'metric.revenueNet': {
    id: 'Reporting.metric.revenueNet',
    defaultMessage: 'Net revenue',
  },
  'metric.revenueNetCash': {
    id: 'Reporting.metric.revenueNetCash',
    defaultMessage: 'Net revenue (cash date)',
  },
  'metric.discountValue': {
    id: 'Reporting.metric.discountValue',
    defaultMessage: 'Discount',
  },
  'metric.shippingRevenue': {
    id: 'Reporting.metric.shippingRevenue',
    defaultMessage: 'Shipping revenue',
  },
  'metric.taxCollected': {
    id: 'Reporting.metric.taxCollected',
    defaultMessage: 'Tax collected',
  },
  'metric.unitsSold': {
    id: 'Reporting.metric.unitsSold',
    defaultMessage: 'Units sold',
  },
  'metric.linesCount': {
    id: 'Reporting.metric.linesCount',
    defaultMessage: 'Order lines',
  },
  'metric.refundsValue': {
    id: 'Reporting.metric.refundsValue',
    defaultMessage: 'Refunds',
  },
  'metric.returnsUnits': {
    id: 'Reporting.metric.returnsUnits',
    defaultMessage: 'Units returned',
  },
  'metric.customersNew': {
    id: 'Reporting.metric.customersNew',
    defaultMessage: 'New customers',
  },
  'metric.customersActive': {
    id: 'Reporting.metric.customersActive',
    defaultMessage: 'Active customers',
  },
  'metric.cohortSize': {
    id: 'Reporting.metric.cohortSize',
    defaultMessage: 'Cohort size',
  },
  'metric.customersRetained': {
    id: 'Reporting.metric.customersRetained',
    defaultMessage: 'Customers retained',
  },
  'metric.productsCount': {
    id: 'Reporting.metric.productsCount',
    defaultMessage: 'Products',
  },
  'metric.variantsCount': {
    id: 'Reporting.metric.variantsCount',
    defaultMessage: 'Variants',
  },
  'metric.priceMin': {
    id: 'Reporting.metric.priceMin',
    defaultMessage: 'Lowest price',
  },
  'metric.priceMax': {
    id: 'Reporting.metric.priceMax',
    defaultMessage: 'Highest price',
  },
  'metric.priceMean': {
    id: 'Reporting.metric.priceMean',
    defaultMessage: 'Average price',
  },
  'metric.inventoryAvailable': {
    id: 'Reporting.metric.inventoryAvailable',
    defaultMessage: 'Available stock',
  },
  'metric.sessions': {
    id: 'Reporting.metric.sessions',
    defaultMessage: 'Sessions',
  },
  'metric.activeUsers': {
    id: 'Reporting.metric.activeUsers',
    defaultMessage: 'Users',
  },
  'metric.pageviews': {
    id: 'Reporting.metric.pageviews',
    defaultMessage: 'Page views',
  },
  'metric.productViews': {
    id: 'Reporting.metric.productViews',
    defaultMessage: 'Product views',
  },
  'metric.addToCarts': {
    id: 'Reporting.metric.addToCarts',
    defaultMessage: 'Add to carts',
  },
  'metric.checkoutStarts': {
    id: 'Reporting.metric.checkoutStarts',
    defaultMessage: 'Checkouts started',
  },
  'metric.searches': {
    id: 'Reporting.metric.searches',
    defaultMessage: 'Searches',
  },
  'metric.zeroResultSearches': {
    id: 'Reporting.metric.zeroResultSearches',
    defaultMessage: 'Zero-result searches',
  },
  'metric.costOfGoods': {
    id: 'Reporting.metric.costOfGoods',
    defaultMessage: 'Cost of goods',
  },
  'metric.marketingSpend': {
    id: 'Reporting.metric.marketingSpend',
    defaultMessage: 'Marketing spend',
  },
  'metric.shipments': {
    id: 'Reporting.metric.shipments',
    defaultMessage: 'Shipments',
  },
  'metric.shipmentsOnTime': {
    id: 'Reporting.metric.shipmentsOnTime',
    defaultMessage: 'Shipments on time',
  },
  'metric.supplierFillRate': {
    id: 'Reporting.metric.supplierFillRate',
    defaultMessage: 'Supplier fill rate',
  },
  'metric.pickToShip': {
    id: 'Reporting.metric.pickToShip',
    defaultMessage: 'Pick to ship',
  },
  'metric.discountRedemptions': {
    id: 'Reporting.metric.discountRedemptions',
    defaultMessage: 'Redemptions',
  },
  'metric.ordersWithPromotion': {
    id: 'Reporting.metric.ordersWithPromotion',
    defaultMessage: 'Promoted orders',
  },
  'metric.aov': {
    id: 'Reporting.metric.aov',
    defaultMessage: 'Average order value',
  },
  'metric.unitsPerTransaction': {
    id: 'Reporting.metric.unitsPerTransaction',
    defaultMessage: 'Units per order',
  },
  'metric.discountRate': {
    id: 'Reporting.metric.discountRate',
    defaultMessage: 'Discount rate',
  },
  'metric.refundRate': {
    id: 'Reporting.metric.refundRate',
    defaultMessage: 'Refund rate',
  },
  'metric.returnRate': {
    id: 'Reporting.metric.returnRate',
    defaultMessage: 'Return rate',
  },
  'metric.grossMargin': {
    id: 'Reporting.metric.grossMargin',
    defaultMessage: 'Gross margin',
  },
  'metric.grossMarginRate': {
    id: 'Reporting.metric.grossMarginRate',
    defaultMessage: 'Gross margin %',
  },
  'metric.conversionRate': {
    id: 'Reporting.metric.conversionRate',
    defaultMessage: 'Conversion rate',
  },
  'metric.revenuePerSession': {
    id: 'Reporting.metric.revenuePerSession',
    defaultMessage: 'Revenue per session',
  },
  'metric.addToCartRate': {
    id: 'Reporting.metric.addToCartRate',
    defaultMessage: 'Add-to-cart rate',
  },
  'metric.checkoutCompletionRate': {
    id: 'Reporting.metric.checkoutCompletionRate',
    defaultMessage: 'Checkout completion rate',
  },
  'metric.zeroResultRate': {
    id: 'Reporting.metric.zeroResultRate',
    defaultMessage: 'Zero-result rate',
  },
  'metric.retentionRate': {
    id: 'Reporting.metric.retentionRate',
    defaultMessage: 'Retention rate',
  },
  'metric.roas': { id: 'Reporting.metric.roas', defaultMessage: 'ROAS' },
  'metric.cac': {
    id: 'Reporting.metric.cac',
    defaultMessage: 'Customer acquisition cost',
  },
  'metric.onTimeDispatchRate': {
    id: 'Reporting.metric.onTimeDispatchRate',
    defaultMessage: 'On-time dispatch',
  },
  'metric.promotionPenetration': {
    id: 'Reporting.metric.promotionPenetration',
    defaultMessage: 'Promotion penetration',
  },
});

export const dimensionMessages = defineMessages({
  'dimension.date': { id: 'Reporting.dimension.date', defaultMessage: 'Date' },
  'dimension.currency': {
    id: 'Reporting.dimension.currency',
    defaultMessage: 'Currency',
  },
  'dimension.country': {
    id: 'Reporting.dimension.country',
    defaultMessage: 'Country',
  },
  'dimension.store': {
    id: 'Reporting.dimension.store',
    defaultMessage: 'Store',
  },
  'dimension.product': {
    id: 'Reporting.dimension.product',
    defaultMessage: 'Product',
  },
  'dimension.category': {
    id: 'Reporting.dimension.category',
    defaultMessage: 'Category',
  },
  'dimension.device': {
    id: 'Reporting.dimension.device',
    defaultMessage: 'Device',
  },
  'dimension.distributionChannel': {
    id: 'Reporting.dimension.distributionChannel',
    defaultMessage: 'Sales channel',
  },
  'dimension.customerGroup': {
    id: 'Reporting.dimension.customerGroup',
    defaultMessage: 'Customer group',
  },
  'dimension.businessUnit': {
    id: 'Reporting.dimension.businessUnit',
    defaultMessage: 'Business unit',
  },
  'dimension.orderState': {
    id: 'Reporting.dimension.orderState',
    defaultMessage: 'Order status',
  },
  'dimension.paymentState': {
    id: 'Reporting.dimension.paymentState',
    defaultMessage: 'Payment status',
  },
  'dimension.shipmentState': {
    id: 'Reporting.dimension.shipmentState',
    defaultMessage: 'Shipment status',
  },
  'dimension.paymentMethod': {
    id: 'Reporting.dimension.paymentMethod',
    defaultMessage: 'Payment method',
  },
  'dimension.shippingMethod': {
    id: 'Reporting.dimension.shippingMethod',
    defaultMessage: 'Shipping method',
  },
  'dimension.discountCode': {
    id: 'Reporting.dimension.discountCode',
    defaultMessage: 'Discount code',
  },
  'dimension.cartDiscount': {
    id: 'Reporting.dimension.cartDiscount',
    defaultMessage: 'Cart discount',
  },
  'dimension.customerType': {
    id: 'Reporting.dimension.customerType',
    defaultMessage: 'Customer type',
  },
  'dimension.cohortMonth': {
    id: 'Reporting.dimension.cohortMonth',
    defaultMessage: 'Cohort',
  },
  'dimension.periodIndex': {
    id: 'Reporting.dimension.periodIndex',
    defaultMessage: 'Period',
  },
  'dimension.rfmSegment': {
    id: 'Reporting.dimension.rfmSegment',
    defaultMessage: 'RFM segment',
  },
  'dimension.returnReason': {
    id: 'Reporting.dimension.returnReason',
    defaultMessage: 'Return reason',
  },
  'dimension.brand': {
    id: 'Reporting.dimension.brand',
    defaultMessage: 'Brand',
  },
  'dimension.productType': {
    id: 'Reporting.dimension.productType',
    defaultMessage: 'Product type',
  },
  'dimension.priceBand': {
    id: 'Reporting.dimension.priceBand',
    defaultMessage: 'Price band',
  },
  'dimension.ageBucket': {
    id: 'Reporting.dimension.ageBucket',
    defaultMessage: 'Age',
  },
  'dimension.trafficChannel': {
    id: 'Reporting.dimension.trafficChannel',
    defaultMessage: 'Traffic channel',
  },
  'dimension.sourceMedium': {
    id: 'Reporting.dimension.sourceMedium',
    defaultMessage: 'Source / medium',
  },
  'dimension.campaign': {
    id: 'Reporting.dimension.campaign',
    defaultMessage: 'Campaign',
  },
  'dimension.landingPage': {
    id: 'Reporting.dimension.landingPage',
    defaultMessage: 'Landing page',
  },
  'dimension.searchTerm': {
    id: 'Reporting.dimension.searchTerm',
    defaultMessage: 'Search term',
  },
  'dimension.funnelStep': {
    id: 'Reporting.dimension.funnelStep',
    defaultMessage: 'Funnel step',
  },
  'dimension.warehouse': {
    id: 'Reporting.dimension.warehouse',
    defaultMessage: 'Warehouse',
  },
  'dimension.supplier': {
    id: 'Reporting.dimension.supplier',
    defaultMessage: 'Supplier',
  },
  'dimension.carrier': {
    id: 'Reporting.dimension.carrier',
    defaultMessage: 'Carrier',
  },
});

export const reportMessages = defineMessages({
  'report.tradingDashboard.title': {
    id: 'Reporting.report.tradingDashboard.title',
    defaultMessage: 'Trading dashboard',
  },
  'report.tradingDashboard.description': {
    id: 'Reporting.report.tradingDashboard.description',
    defaultMessage:
      'Daily revenue, orders, average order value and conversion at a glance.',
  },
  'report.tradingDashboard.revenueTrend': {
    id: 'Reporting.report.tradingDashboard.revenueTrend',
    defaultMessage: 'Revenue and orders over time',
  },
  'report.tradingDashboard.byChannel': {
    id: 'Reporting.report.tradingDashboard.byChannel',
    defaultMessage: 'Revenue by sales channel',
  },
  'report.tradingDashboard.topProducts': {
    id: 'Reporting.report.tradingDashboard.topProducts',
    defaultMessage: 'Top products',
  },
  'report.catalogueHealth.title': {
    id: 'Reporting.report.catalogueHealth.title',
    defaultMessage: 'Catalogue health and coverage',
  },
  'report.catalogueHealth.description': {
    id: 'Reporting.report.catalogueHealth.description',
    defaultMessage:
      'Live catalogue size, category mix and price architecture. Needs no rollup — read straight from Product Search.',
  },
  'report.catalogueHealth.byCategory': {
    id: 'Reporting.report.catalogueHealth.byCategory',
    defaultMessage: 'Products by category',
  },
  'report.catalogueHealth.priceBands': {
    id: 'Reporting.report.catalogueHealth.priceBands',
    defaultMessage: 'Price band distribution',
  },
  'report.catalogueHealth.priceStats': {
    id: 'Reporting.report.catalogueHealth.priceStats',
    defaultMessage: 'Price statistics by category',
  },
  'report.needsWebAnalyticsSource': {
    id: 'Reporting.report.needsWebAnalyticsSource',
    defaultMessage: 'Connect a web analytics source to see this metric.',
  },

  'report.cohortRetention.description': {
    id: 'Reporting.report.cohortRetention.description',
    defaultMessage: 'Repeat-purchase retention by acquisition cohort and period.',
  },
  'report.cohortRetention.heatmap': {
    id: 'Reporting.report.cohortRetention.heatmap',
    defaultMessage: 'Retention by cohort',
  },
  'report.cohortRetention.title': {
    id: 'Reporting.report.cohortRetention.title',
    defaultMessage: 'Cohort retention',
  },
  'report.conversionFunnel.description': {
    id: 'Reporting.report.conversionFunnel.description',
    defaultMessage: 'Sessions to order, step by step — web analytics with order truth.',
  },
  'report.conversionFunnel.funnel': {
    id: 'Reporting.report.conversionFunnel.funnel',
    defaultMessage: 'Conversion funnel',
  },
  'report.conversionFunnel.title': {
    id: 'Reporting.report.conversionFunnel.title',
    defaultMessage: 'Conversion funnel',
  },
  'report.deviceGeography.byDevice': {
    id: 'Reporting.report.deviceGeography.byDevice',
    defaultMessage: 'Sessions by device',
  },
  'report.deviceGeography.description': {
    id: 'Reporting.report.deviceGeography.description',
    defaultMessage: 'Sessions and conversion by device and country.',
  },
  'report.deviceGeography.geo': {
    id: 'Reporting.report.deviceGeography.geo',
    defaultMessage: 'Sessions by country',
  },
  'report.deviceGeography.title': {
    id: 'Reporting.report.deviceGeography.title',
    defaultMessage: 'Device & geography',
  },
  'report.fulfilmentSla.byCarrier': {
    id: 'Reporting.report.fulfilmentSla.byCarrier',
    defaultMessage: 'Fulfilment by carrier',
  },
  'report.fulfilmentSla.description': {
    id: 'Reporting.report.fulfilmentSla.description',
    defaultMessage: 'On-time dispatch, shipment volume and pick-to-ship by warehouse and carrier.',
  },
  'report.fulfilmentSla.title': {
    id: 'Reporting.report.fulfilmentSla.title',
    defaultMessage: 'Fulfilment SLA',
  },
  'report.fulfilmentSla.trend': {
    id: 'Reporting.report.fulfilmentSla.trend',
    defaultMessage: 'Shipments vs on-time',
  },
  'report.marginErosion.byCat': {
    id: 'Reporting.report.marginErosion.byCat',
    defaultMessage: 'Margin by category',
  },
  'report.marginErosion.description': {
    id: 'Reporting.report.marginErosion.description',
    defaultMessage: 'Discount rate against gross margin over time and by category.',
  },
  'report.marginErosion.title': {
    id: 'Reporting.report.marginErosion.title',
    defaultMessage: 'Discount depth & margin erosion',
  },
  'report.marginErosion.trend': {
    id: 'Reporting.report.marginErosion.trend',
    defaultMessage: 'Discount rate vs margin',
  },
  'report.newVsReturning.byType': {
    id: 'Reporting.report.newVsReturning.byType',
    defaultMessage: 'Revenue by customer type',
  },
  'report.newVsReturning.description': {
    id: 'Reporting.report.newVsReturning.description',
    defaultMessage: 'Revenue and orders split by new and returning customers.',
  },
  'report.newVsReturning.title': {
    id: 'Reporting.report.newVsReturning.title',
    defaultMessage: 'New vs returning customers',
  },
  'report.priceArchitecture.bands': {
    id: 'Reporting.report.priceArchitecture.bands',
    defaultMessage: 'Price band distribution',
  },
  'report.priceArchitecture.description': {
    id: 'Reporting.report.priceArchitecture.description',
    defaultMessage: 'Live price-band distribution and per-category price statistics.',
  },
  'report.priceArchitecture.stats': {
    id: 'Reporting.report.priceArchitecture.stats',
    defaultMessage: 'Price statistics by category',
  },
  'report.priceArchitecture.title': {
    id: 'Reporting.report.priceArchitecture.title',
    defaultMessage: 'Price architecture',
  },
  'report.productPerformance.description': {
    id: 'Reporting.report.productPerformance.description',
    defaultMessage: 'Units, revenue and margin per product — a performance quadrant.',
  },
  'report.productPerformance.quadrant': {
    id: 'Reporting.report.productPerformance.quadrant',
    defaultMessage: 'Units vs margin (bubble = revenue)',
  },
  'report.productPerformance.table': {
    id: 'Reporting.report.productPerformance.table',
    defaultMessage: 'Top products',
  },
  'report.productPerformance.title': {
    id: 'Reporting.report.productPerformance.title',
    defaultMessage: 'Product performance',
  },
  'report.promotionEffectiveness.byCode': {
    id: 'Reporting.report.promotionEffectiveness.byCode',
    defaultMessage: 'Redemptions by code',
  },
  'report.promotionEffectiveness.description': {
    id: 'Reporting.report.promotionEffectiveness.description',
    defaultMessage: 'Redemptions and promoted orders by discount code.',
  },
  'report.promotionEffectiveness.title': {
    id: 'Reporting.report.promotionEffectiveness.title',
    defaultMessage: 'Promotion effectiveness',
  },
  'report.returnsAnalysis.byReason': {
    id: 'Reporting.report.returnsAnalysis.byReason',
    defaultMessage: 'Returns by reason',
  },
  'report.returnsAnalysis.description': {
    id: 'Reporting.report.returnsAnalysis.description',
    defaultMessage: 'Return volume and rate by reason.',
  },
  'report.returnsAnalysis.title': {
    id: 'Reporting.report.returnsAnalysis.title',
    defaultMessage: 'Returns analysis',
  },
  'report.salesByCategory.description': {
    id: 'Reporting.report.salesByCategory.description',
    defaultMessage: 'Revenue and units by product category, with mix.',
  },
  'report.salesByCategory.table': {
    id: 'Reporting.report.salesByCategory.table',
    defaultMessage: 'Category detail',
  },
  'report.salesByCategory.title': {
    id: 'Reporting.report.salesByCategory.title',
    defaultMessage: 'Sales by category',
  },
  'report.salesByCategory.treemap': {
    id: 'Reporting.report.salesByCategory.treemap',
    defaultMessage: 'Revenue by category',
  },
  'report.salesByChannel.byChannel': {
    id: 'Reporting.report.salesByChannel.byChannel',
    defaultMessage: 'Revenue by sales channel',
  },
  'report.salesByChannel.byStore': {
    id: 'Reporting.report.salesByChannel.byStore',
    defaultMessage: 'Sales by store',
  },
  'report.salesByChannel.description': {
    id: 'Reporting.report.salesByChannel.description',
    defaultMessage: 'Revenue, orders and AOV split by sales channel and store.',
  },
  'report.salesByChannel.title': {
    id: 'Reporting.report.salesByChannel.title',
    defaultMessage: 'Sales by channel & store',
  },
  'report.salesByChannel.trend': {
    id: 'Reporting.report.salesByChannel.trend',
    defaultMessage: 'Revenue and orders over time',
  },
  'report.stockCover.byWarehouse': {
    id: 'Reporting.report.stockCover.byWarehouse',
    defaultMessage: 'Stock by warehouse & product',
  },
  'report.stockCover.description': {
    id: 'Reporting.report.stockCover.description',
    defaultMessage: 'On-hand stock and weeks of cover by warehouse.',
  },
  'report.stockCover.title': {
    id: 'Reporting.report.stockCover.title',
    defaultMessage: 'Stock cover',
  },
});
