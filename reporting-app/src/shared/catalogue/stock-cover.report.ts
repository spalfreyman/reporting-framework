import type { ReportDefinitionInput } from '../schema/report-definition';

/** Built-in report: stock-cover */
export const stockCover: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "stock-cover",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.stockCover.title",
  "descriptionKey": "report.stockCover.description",
  "category": "inventory",
  "audience": [
    "planner",
    "supply-chain"
  ],
  "requiredCapabilities": {
    "metrics": [
      "inventory.available"
    ],
    "sourceKinds": [
      "erp",
      "commerce"
    ],
    "permissions": []
  },
  "optionalMetrics": [],
  "failurePolicy": "strict",
  "defaults": {
    "datePreset": "today",
    "grain": "day",
    "timezone": "project",
    "weekStart": "monday",
    "comparison": {
      "kind": "none",
      "alignBy": "date"
    },
    "fx": {
      "mode": "none",
      "rateDate": "transactionDate"
    },
    "filters": []
  },
  "allowedFilters": [
    {
      "dimension": "warehouse",
      "ops": [
        "in"
      ],
      "multi": true,
      "required": false,
      "valueSource": "dsp"
    },
    {
      "dimension": "category",
      "ops": [
        "in"
      ],
      "multi": true,
      "required": false,
      "valueSource": "ct-categories"
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
          "kpi-stock"
        ]
      },
      {
        "id": "r1",
        "tileIds": [
          "by-wh"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "kpi-stock",
      "titleKey": "metric.inventoryAvailable",
      "span": 4,
      "query": {
        "metrics": [
          "inventory.available"
        ],
        "dimensions": [],
        "pointInTime": true,
        "comparison": "none"
      },
      "chart": {
        "specVersion": 1,
        "type": "kpi",
        "encoding": {
          "value": {
            "field": "inventory.available",
            "from": "primary"
          }
        },
        "options": {
          "goodDirection": "neutral"
        }
      }
    },
    {
      "id": "by-wh",
      "titleKey": "report.stockCover.byWarehouse",
      "span": 12,
      "query": {
        "metrics": [
          "inventory.available"
        ],
        "dimensions": [
          "warehouse",
          "product"
        ],
        "pointInTime": true,
        "comparison": "none",
        "orderBy": [
          {
            "column": "inventory.available",
            "direction": "desc"
          }
        ],
        "limit": 100
      },
      "chart": {
        "specVersion": 1,
        "type": "table",
        "encoding": {
          "columns": [
            {
              "field": "warehouse",
              "from": "primary"
            },
            {
              "field": "product",
              "from": "primary"
            },
            {
              "field": "inventory.available",
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
