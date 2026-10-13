import type { ReportDefinitionInput } from '../schema/report-definition.js';

/** Built-in report: price-architecture */
export const priceArchitecture: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "price-architecture",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.priceArchitecture.title",
  "descriptionKey": "report.priceArchitecture.description",
  "category": "merchandising",
  "audience": [
    "pricing-manager"
  ],
  "requiredCapabilities": {
    "metrics": [
      "products.count"
    ],
    "sourceKinds": [
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
    "filters": [
      {
        "dimension": "currency",
        "op": "eq",
        "value": "EUR"
      }
    ]
  },
  "allowedFilters": [
    {
      "dimension": "currency",
      "ops": [
        "eq"
      ],
      "multi": false,
      "required": true,
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
          "bands"
        ]
      },
      {
        "id": "r1",
        "tileIds": [
          "stats"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "bands",
      "titleKey": "report.priceArchitecture.bands",
      "span": 12,
      "query": {
        "metrics": [
          "products.count"
        ],
        "dimensions": [
          "priceBand"
        ],
        "pointInTime": true,
        "comparison": "none"
      },
      "chart": {
        "specVersion": 1,
        "type": "histogram",
        "encoding": {
          "category": {
            "field": "priceBand",
            "from": "primary"
          },
          "value": {
            "field": "products.count",
            "from": "primary"
          }
        },
        "options": {
          "yZero": true
        }
      }
    },
    {
      "id": "stats",
      "titleKey": "report.priceArchitecture.stats",
      "span": 12,
      "query": {
        "metrics": [
          "price.min",
          "price.mean",
          "price.max",
          "products.count"
        ],
        "dimensions": [
          "category"
        ],
        "pointInTime": true,
        "comparison": "none",
        "orderBy": [
          {
            "column": "products.count",
            "direction": "desc"
          }
        ],
        "limit": 50
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
              "field": "products.count",
              "from": "primary"
            },
            {
              "field": "price.min",
              "from": "primary"
            },
            {
              "field": "price.mean",
              "from": "primary"
            },
            {
              "field": "price.max",
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
