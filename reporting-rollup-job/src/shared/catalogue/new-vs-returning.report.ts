import type { ReportDefinitionInput } from '../schema/report-definition.js';

/** Built-in report: new-vs-returning */
export const newVsReturning: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "new-vs-returning",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.newVsReturning.title",
  "descriptionKey": "report.newVsReturning.description",
  "category": "customer",
  "audience": [
    "crm-manager"
  ],
  "requiredCapabilities": {
    "metrics": [
      "orders.count@orderdate",
      "customers.new@orderdate"
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
      "dimension": "customerType",
      "ops": [
        "in"
      ],
      "multi": true,
      "required": false,
      "valueSource": "dsp"
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
          "kpi-new",
          "kpi-orders"
        ]
      },
      {
        "id": "r1",
        "tileIds": [
          "by-type"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "kpi-new",
      "titleKey": "metric.customers.new@orderdate",
      "span": 3,
      "query": {
        "metrics": [
          "customers.new@orderdate"
        ],
        "dimensions": [],
        "comparison": "inherit"
      },
      "chart": {
        "specVersion": 1,
        "type": "kpi",
        "encoding": {
          "value": {
            "field": "customers.new@orderdate",
            "from": "primary"
          },
          "compare": {
            "field": "customers.new@orderdate",
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
      "id": "by-type",
      "titleKey": "report.newVsReturning.byType",
      "span": 12,
      "query": {
        "metrics": [
          "revenue.net@orderdate",
          "orders.count@orderdate"
        ],
        "dimensions": [
          "customerType"
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
        "type": "breakdown",
        "encoding": {
          "category": {
            "field": "customerType",
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
    }
  ],
  "export": {
    "csv": true,
    "maxRows": 50000
  }
};
