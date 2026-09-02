import type { ReportDefinitionInput } from '../schema/report-definition';

/** Built-in report: trading-dashboard */
export const tradingDashboard: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "trading-dashboard",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.tradingDashboard.title",
  "descriptionKey": "report.tradingDashboard.description",
  "category": "trading",
  "audience": [
    "ecommerce-director",
    "head-of-trading"
  ],
  "requiredCapabilities": {
    "metrics": [
      "orders.count@orderdate",
      "revenue.net@orderdate"
    ],
    "sourceKinds": [
      "commerce"
    ],
    "permissions": []
  },
  "optionalMetrics": [
    "sessions.count",
    "conversion.rate"
  ],
  "failurePolicy": "lenient",
  "defaults": {
    "datePreset": "last28d",
    "grain": "day",
    "timezone": "project",
    "weekStart": "monday",
    "comparison": {
      "kind": "previousPeriod",
      "alignBy": "weekday"
    },
    "fx": {
      "mode": "none",
      "rateDate": "transactionDate"
    },
    "filters": []
  },
  "allowedFilters": [
    {
      "dimension": "store",
      "ops": [
        "in"
      ],
      "multi": true,
      "valueSource": "ct-stores"
    },
    {
      "dimension": "distributionChannel",
      "ops": [
        "in"
      ],
      "multi": true,
      "valueSource": "ct-channels"
    },
    {
      "dimension": "country",
      "ops": [
        "in"
      ],
      "multi": true,
      "valueSource": "dsp"
    },
    {
      "dimension": "currency",
      "ops": [
        "in"
      ],
      "multi": true,
      "valueSource": "dsp"
    }
  ],
  "freshness": {
    "maxAcceptableLagSeconds": 86400,
    "showAsOf": true
  },
  "layout": {
    "rows": [
      {
        "id": "kpis",
        "tileIds": [
          "kpi-revenue",
          "kpi-orders",
          "kpi-aov",
          "kpi-conversion"
        ]
      },
      {
        "id": "trend",
        "tileIds": [
          "revenue-trend"
        ]
      },
      {
        "id": "breakdowns",
        "tileIds": [
          "by-channel",
          "top-products"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "kpi-revenue",
      "titleKey": "metric.revenueNet",
      "span": 3,
      "query": {
        "metrics": [
          "revenue.net@orderdate"
        ],
        "dimensions": [],
        "comparison": "inherit"
      },
      "chart": {
        "specVersion": 1,
        "type": "kpi",
        "encoding": {
          "value": {
            "field": "revenue.net@orderdate",
            "from": "primary"
          },
          "compare": {
            "field": "revenue.net@orderdate",
            "from": "comparison"
          },
          "trend": {
            "field": "revenue.net@orderdate",
            "over": "date"
          }
        },
        "options": {
          "goodDirection": "up"
        }
      }
    },
    {
      "id": "kpi-orders",
      "titleKey": "metric.orders",
      "span": 3,
      "query": {
        "metrics": [
          "orders.count@orderdate"
        ],
        "dimensions": [],
        "comparison": "inherit"
      },
      "chart": {
        "specVersion": 1,
        "type": "kpi",
        "encoding": {
          "value": {
            "field": "orders.count@orderdate",
            "from": "primary"
          },
          "compare": {
            "field": "orders.count@orderdate",
            "from": "comparison"
          },
          "trend": {
            "field": "orders.count@orderdate",
            "over": "date"
          }
        },
        "options": {
          "goodDirection": "up"
        }
      }
    },
    {
      "id": "kpi-aov",
      "titleKey": "metric.aov",
      "span": 3,
      "query": {
        "metrics": [
          "aov@orderdate"
        ],
        "dimensions": [],
        "comparison": "inherit"
      },
      "chart": {
        "specVersion": 1,
        "type": "kpi",
        "encoding": {
          "value": {
            "field": "aov@orderdate",
            "from": "primary"
          },
          "compare": {
            "field": "aov@orderdate",
            "from": "comparison"
          }
        },
        "options": {
          "goodDirection": "up"
        }
      }
    },
    {
      "id": "kpi-conversion",
      "titleKey": "metric.conversionRate",
      "span": 3,
      "query": {
        "metrics": [
          "conversion.rate"
        ],
        "dimensions": [],
        "comparison": "inherit",
        "onGrainMismatch": "coarsen"
      },
      "chart": {
        "specVersion": 1,
        "type": "kpi",
        "encoding": {
          "value": {
            "field": "conversion.rate",
            "from": "primary"
          },
          "compare": {
            "field": "conversion.rate",
            "from": "comparison"
          }
        },
        "options": {
          "goodDirection": "up"
        }
      },
      "emptyStateKey": "report.needsWebAnalyticsSource",
      "requiresSources": []
    },
    {
      "id": "revenue-trend",
      "titleKey": "report.tradingDashboard.revenueTrend",
      "span": 12,
      "query": {
        "metrics": [
          "revenue.net@orderdate",
          "orders.count@orderdate"
        ],
        "dimensions": [],
        "grain": "inherit",
        "comparison": "inherit"
      },
      "chart": {
        "specVersion": 1,
        "type": "timeseries",
        "encoding": {
          "x": {
            "field": "date"
          },
          "y": [
            {
              "field": "revenue.net@orderdate",
              "mark": "area",
              "axis": "left"
            },
            {
              "field": "orders.count@orderdate",
              "mark": "line",
              "axis": "right"
            }
          ]
        },
        "options": {
          "dualAxis": true,
          "showLegend": true,
          "showComparisonGhost": true
        }
      }
    },
    {
      "id": "by-channel",
      "titleKey": "report.tradingDashboard.byChannel",
      "span": 6,
      "query": {
        "metrics": [
          "revenue.net@orderdate",
          "orders.count@orderdate"
        ],
        "dimensions": [
          "distributionChannel"
        ],
        "comparison": "none",
        "orderBy": [
          {
            "column": "revenue.net@orderdate",
            "direction": "desc"
          }
        ],
        "topN": {
          "by": "revenue.net@orderdate",
          "n": 10,
          "otherBucket": true
        }
      },
      "chart": {
        "specVersion": 1,
        "type": "breakdown",
        "encoding": {
          "category": {
            "field": "distributionChannel"
          },
          "y": [
            {
              "field": "revenue.net@orderdate",
              "mark": "bar"
            }
          ]
        },
        "options": {
          "showDataLabels": true
        }
      }
    },
    {
      "id": "top-products",
      "titleKey": "report.tradingDashboard.topProducts",
      "span": 6,
      "query": {
        "metrics": [
          "units.sold@orderdate",
          "revenue.net@orderdate",
          "return.rate"
        ],
        "dimensions": [
          "product"
        ],
        "comparison": "none",
        "orderBy": [
          {
            "column": "revenue.net@orderdate",
            "direction": "desc"
          }
        ],
        "topN": {
          "by": "revenue.net@orderdate",
          "n": 20,
          "otherBucket": false
        }
      },
      "chart": {
        "specVersion": 1,
        "type": "table",
        "encoding": {
          "columns": [
            {
              "field": "product"
            },
            {
              "field": "units.sold@orderdate"
            },
            {
              "field": "revenue.net@orderdate"
            },
            {
              "field": "return.rate"
            }
          ]
        },
        "options": {
          "pageSize": 20,
          "totalsRow": true
        }
      },
      "drilldown": {
        "toReportId": "product-performance",
        "addDimensions": []
      }
    }
  ],
  "export": {
    "csv": true,
    "maxRows": 50000
  }
};
