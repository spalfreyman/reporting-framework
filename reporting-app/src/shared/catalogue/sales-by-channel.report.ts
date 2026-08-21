import type { ReportDefinitionInput } from '../schema/report-definition';

/** Built-in report: sales-by-channel */
export const salesByChannel: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "sales-by-channel",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.salesByChannel.title",
  "descriptionKey": "report.salesByChannel.description",
  "category": "trading",
  "audience": [
    "trading-manager"
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
  "optionalMetrics": [],
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
      "dimension": "distributionChannel",
      "ops": [
        "in"
      ],
      "multi": true,
      "required": false,
      "valueSource": "ct-channels"
    },
    {
      "dimension": "store",
      "ops": [
        "in"
      ],
      "multi": true,
      "required": false,
      "valueSource": "ct-stores"
    },
    {
      "dimension": "currency",
      "ops": [
        "in"
      ],
      "multi": true,
      "required": false,
      "valueSource": "dsp"
    }
  ],
  "freshness": {
    "showAsOf": true
  },
  "layout": {
    "rows": [
      {
        "id": "r0",
        "tileIds": [
          "kpi-rev",
          "kpi-orders",
          "kpi-aov"
        ]
      },
      {
        "id": "r1",
        "tileIds": [
          "trend"
        ]
      },
      {
        "id": "r2",
        "tileIds": [
          "by-channel",
          "by-store"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "kpi-rev",
      "titleKey": "metric.revenue.net@orderdate",
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
          }
        },
        "options": {
          "goodDirection": "up"
        }
      }
    },
    {
      "id": "kpi-orders",
      "titleKey": "metric.orders.count@orderdate",
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
          }
        },
        "options": {
          "goodDirection": "up"
        }
      }
    },
    {
      "id": "kpi-aov",
      "titleKey": "metric.aov@orderdate",
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
      "id": "trend",
      "titleKey": "report.salesByChannel.trend",
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
            "field": "date",
            "from": "primary"
          },
          "y": [
            {
              "field": "revenue.net@orderdate",
              "from": "primary",
              "mark": "area",
              "axis": "left"
            },
            {
              "field": "orders.count@orderdate",
              "from": "primary",
              "mark": "line",
              "axis": "right"
            }
          ]
        },
        "options": {
          "dualAxis": true,
          "showLegend": true
        }
      }
    },
    {
      "id": "by-channel",
      "titleKey": "report.salesByChannel.byChannel",
      "span": 6,
      "query": {
        "metrics": [
          "revenue.net@orderdate"
        ],
        "dimensions": [
          "distributionChannel"
        ],
        "comparison": "none",
        "topN": {
          "by": "revenue.net@orderdate",
          "n": 10,
          "otherBucket": true
        },
        "orderBy": [
          {
            "column": "revenue.net@orderdate",
            "direction": "desc"
          }
        ]
      },
      "chart": {
        "specVersion": 1,
        "type": "breakdown",
        "encoding": {
          "category": {
            "field": "distributionChannel",
            "from": "primary"
          },
          "y": [
            {
              "field": "revenue.net@orderdate",
              "mark": "bar",
              "from": "primary"
            }
          ]
        },
        "options": {
          "showDataLabels": true
        }
      }
    },
    {
      "id": "by-store",
      "titleKey": "report.salesByChannel.byStore",
      "span": 6,
      "query": {
        "metrics": [
          "revenue.net@orderdate",
          "orders.count@orderdate"
        ],
        "dimensions": [
          "store"
        ],
        "comparison": "none",
        "orderBy": [
          {
            "column": "revenue.net@orderdate",
            "direction": "desc"
          }
        ]
      },
      "chart": {
        "specVersion": 1,
        "type": "table",
        "encoding": {
          "columns": [
            {
              "field": "store",
              "from": "primary"
            },
            {
              "field": "revenue.net@orderdate",
              "from": "primary"
            },
            {
              "field": "orders.count@orderdate",
              "from": "primary"
            }
          ]
        },
        "options": {
          "pageSize": 25,
          "totalsRow": true
        }
      }
    }
  ],
  "export": {
    "csv": true,
    "maxRows": 50000
  }
};
