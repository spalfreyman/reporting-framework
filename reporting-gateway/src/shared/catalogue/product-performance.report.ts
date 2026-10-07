import type { ReportDefinitionInput } from '../schema/report-definition.js';

/** Built-in report: product-performance */
export const productPerformance: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "product-performance",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.productPerformance.title",
  "descriptionKey": "report.productPerformance.description",
  "category": "merchandising",
  "audience": [
    "merchandiser"
  ],
  "requiredCapabilities": {
    "metrics": [
      "units.sold@orderdate",
      "revenue.net@orderdate"
    ],
    "sourceKinds": [
      "commerce"
    ],
    "permissions": []
  },
  "optionalMetrics": [
    "margin.gross@orderdate",
    "return.rate"
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
          "quadrant"
        ]
      },
      {
        "id": "r1",
        "tileIds": [
          "table"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "quadrant",
      "titleKey": "report.productPerformance.quadrant",
      "span": 12,
      "query": {
        "metrics": [
          "units.sold@orderdate",
          "margin.gross@orderdate",
          "revenue.net@orderdate"
        ],
        "dimensions": [
          "product"
        ],
        "comparison": "none",
        "limit": 200
      },
      "chart": {
        "specVersion": 1,
        "type": "scatter",
        "encoding": {
          "x": {
            "field": "units.sold@orderdate",
            "from": "primary"
          },
          "y": [
            {
              "field": "margin.gross@orderdate",
              "from": "primary"
            }
          ],
          "size": {
            "field": "revenue.net@orderdate",
            "from": "primary"
          },
          "point": {
            "field": "product",
            "from": "primary"
          }
        },
        "options": {}
      }
    },
    {
      "id": "table",
      "titleKey": "report.productPerformance.table",
      "span": 12,
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
        "topN": {
          "by": "revenue.net@orderdate",
          "n": 50,
          "otherBucket": false
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
        "type": "table",
        "encoding": {
          "columns": [
            {
              "field": "product",
              "from": "primary"
            },
            {
              "field": "units.sold@orderdate",
              "from": "primary"
            },
            {
              "field": "revenue.net@orderdate",
              "from": "primary"
            },
            {
              "field": "return.rate",
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
