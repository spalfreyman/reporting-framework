import type { ReportDefinitionInput } from '../schema/report-definition';

/** Built-in report: margin-erosion */
export const marginErosion: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "margin-erosion",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.marginErosion.title",
  "descriptionKey": "report.marginErosion.description",
  "category": "promotions",
  "audience": [
    "finance",
    "trading-manager"
  ],
  "requiredCapabilities": {
    "metrics": [
      "revenue.net@orderdate",
      "discount.value@orderdate"
    ],
    "sourceKinds": [
      "commerce"
    ],
    "permissions": []
  },
  "optionalMetrics": [
    "margin.rate@orderdate",
    "cost.goods@orderdate"
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
      "dimension": "category",
      "ops": [
        "in"
      ],
      "multi": true,
      "required": false,
      "valueSource": "ct-categories"
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
          "kpi-disc",
          "kpi-margin"
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
          "by-cat"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "kpi-disc",
      "titleKey": "metric.discount.rate@orderdate",
      "span": 3,
      "query": {
        "metrics": [
          "discount.rate@orderdate"
        ],
        "dimensions": [],
        "comparison": "inherit"
      },
      "chart": {
        "specVersion": 1,
        "type": "kpi",
        "encoding": {
          "value": {
            "field": "discount.rate@orderdate",
            "from": "primary"
          },
          "compare": {
            "field": "discount.rate@orderdate",
            "from": "comparison"
          }
        },
        "options": {
          "goodDirection": "down"
        }
      }
    },
    {
      "id": "kpi-margin",
      "titleKey": "metric.margin.rate@orderdate",
      "span": 3,
      "query": {
        "metrics": [
          "margin.rate@orderdate"
        ],
        "dimensions": [],
        "comparison": "inherit"
      },
      "chart": {
        "specVersion": 1,
        "type": "kpi",
        "encoding": {
          "value": {
            "field": "margin.rate@orderdate",
            "from": "primary"
          },
          "compare": {
            "field": "margin.rate@orderdate",
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
      "titleKey": "report.marginErosion.trend",
      "span": 12,
      "query": {
        "metrics": [
          "discount.rate@orderdate",
          "margin.rate@orderdate"
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
              "field": "discount.rate@orderdate",
              "from": "primary",
              "mark": "line"
            },
            {
              "field": "margin.rate@orderdate",
              "from": "primary",
              "mark": "line"
            }
          ]
        },
        "options": {
          "showLegend": true
        }
      }
    },
    {
      "id": "by-cat",
      "titleKey": "report.marginErosion.byCat",
      "span": 12,
      "query": {
        "metrics": [
          "revenue.net@orderdate",
          "margin.rate@orderdate",
          "discount.rate@orderdate"
        ],
        "dimensions": [
          "category"
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
              "field": "category",
              "from": "primary"
            },
            {
              "field": "revenue.net@orderdate",
              "from": "primary"
            },
            {
              "field": "discount.rate@orderdate",
              "from": "primary"
            },
            {
              "field": "margin.rate@orderdate",
              "from": "primary"
            }
          ]
        },
        "options": {
          "pageSize": 25
        }
      }
    }
  ],
  "export": {
    "csv": true,
    "maxRows": 50000
  }
};
