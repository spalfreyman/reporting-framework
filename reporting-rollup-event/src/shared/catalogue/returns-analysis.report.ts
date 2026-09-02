import type { ReportDefinitionInput } from '../schema/report-definition.js';

/** Built-in report: returns-analysis */
export const returnsAnalysis: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "returns-analysis",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.returnsAnalysis.title",
  "descriptionKey": "report.returnsAnalysis.description",
  "category": "operations",
  "audience": [
    "operations-manager",
    "merchandiser"
  ],
  "requiredCapabilities": {
    "metrics": [
      "returns.units@orderdate"
    ],
    "sourceKinds": [
      "commerce",
      "oms"
    ],
    "permissions": []
  },
  "optionalMetrics": [
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
      "dimension": "returnReason",
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
          "by-reason"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "by-reason",
      "titleKey": "report.returnsAnalysis.byReason",
      "span": 12,
      "query": {
        "metrics": [
          "returns.units@orderdate"
        ],
        "dimensions": [
          "returnReason"
        ],
        "comparison": "none",
        "orderBy": [
          {
            "column": "returns.units@orderdate",
            "direction": "desc"
          }
        ]
      },
      "chart": {
        "specVersion": 1,
        "type": "breakdown",
        "encoding": {
          "category": {
            "field": "returnReason",
            "from": "primary"
          },
          "y": [
            {
              "field": "returns.units@orderdate",
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
