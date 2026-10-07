import type { ReportDefinitionInput } from '../schema/report-definition';

/** Built-in report: cohort-retention */
export const cohortRetention: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "cohort-retention",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.cohortRetention.title",
  "descriptionKey": "report.cohortRetention.description",
  "category": "customer",
  "audience": [
    "crm-manager",
    "growth"
  ],
  "requiredCapabilities": {
    "metrics": [
      "customers.cohortSize",
      "customers.retained"
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
  "allowedFilters": [],
  "freshness": {
    "showAsOf": true
  },
  "layout": {
    "rows": [
      {
        "id": "r0",
        "tileIds": [
          "heatmap"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "heatmap",
      "titleKey": "report.cohortRetention.heatmap",
      "span": 12,
      "query": {
        "metrics": [
          "retention.rate"
        ],
        "dimensions": [
          "cohortMonth",
          "periodIndex"
        ],
        "comparison": "none",
        "grain": "month"
      },
      "chart": {
        "specVersion": 1,
        "type": "heatmap",
        "encoding": {
          "row": {
            "field": "cohortMonth",
            "from": "primary"
          },
          "column": {
            "field": "periodIndex",
            "from": "primary"
          },
          "value": {
            "field": "retention.rate",
            "from": "primary"
          }
        },
        "options": {
          "colourScale": "sequential"
        }
      }
    }
  ],
  "export": {
    "csv": true,
    "maxRows": 50000
  }
};
