import type { ReportDefinitionInput } from '../schema/report-definition.js';

/** Built-in report: sales-by-category */
export const salesByCategory: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "sales-by-category",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.salesByCategory.title",
  "descriptionKey": "report.salesByCategory.description",
  "category": "trading",
  "audience": [
    "category-manager"
  ],
  "requiredCapabilities": {
    "metrics": [
      "revenue.net@orderdate",
      "units.sold@orderdate"
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
          "kpi-rev",
          "kpi-units"
        ]
      },
      {
        "id": "r1",
        "tileIds": [
          "treemap"
        ]
      },
      {
        "id": "r2",
        "tileIds": [
          "table"
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
      "id": "kpi-units",
      "titleKey": "metric.units.sold@orderdate",
      "span": 3,
      "query": {
        "metrics": [
          "units.sold@orderdate"
        ],
        "dimensions": [],
        "comparison": "inherit"
      },
      "chart": {
        "specVersion": 1,
        "type": "kpi",
        "encoding": {
          "value": {
            "field": "units.sold@orderdate",
            "from": "primary"
          },
          "compare": {
            "field": "units.sold@orderdate",
            "from": "comparison"
          }
        },
        "options": {
          "goodDirection": "up"
        }
      }
    },
    {
      "id": "treemap",
      "titleKey": "report.salesByCategory.treemap",
      "span": 12,
      "query": {
        "metrics": [
          "revenue.net@orderdate"
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
        "type": "treemap",
        "encoding": {
          "category": {
            "field": "category",
            "from": "primary"
          },
          "value": {
            "field": "revenue.net@orderdate",
            "from": "primary"
          }
        },
        "options": {
          "topN": 20
        }
      }
    },
    {
      "id": "table",
      "titleKey": "report.salesByCategory.table",
      "span": 12,
      "query": {
        "metrics": [
          "revenue.net@orderdate",
          "units.sold@orderdate"
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
              "field": "units.sold@orderdate",
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
