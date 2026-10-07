import type { ReportDefinitionInput } from '../schema/report-definition.js';

/** Built-in report: device-geography */
export const deviceGeography: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "device-geography",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.deviceGeography.title",
  "descriptionKey": "report.deviceGeography.description",
  "category": "marketing",
  "audience": [
    "marketing",
    "ux"
  ],
  "requiredCapabilities": {
    "metrics": [
      "sessions.count"
    ],
    "sourceKinds": [
      "web-analytics"
    ],
    "permissions": []
  },
  "optionalMetrics": [
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
      "dimension": "device",
      "ops": [
        "in"
      ],
      "multi": true,
      "required": false,
      "valueSource": "dsp"
    },
    {
      "dimension": "country",
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
          "by-device"
        ]
      },
      {
        "id": "r1",
        "tileIds": [
          "geo"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "by-device",
      "titleKey": "report.deviceGeography.byDevice",
      "span": 12,
      "query": {
        "metrics": [
          "sessions.count",
          "conversion.rate"
        ],
        "dimensions": [
          "device"
        ],
        "comparison": "none",
        "orderBy": [
          {
            "column": "sessions.count",
            "direction": "desc"
          }
        ]
      },
      "chart": {
        "specVersion": 1,
        "type": "breakdown",
        "encoding": {
          "category": {
            "field": "device",
            "from": "primary"
          },
          "y": [
            {
              "field": "sessions.count",
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
      "id": "geo",
      "titleKey": "report.deviceGeography.geo",
      "span": 12,
      "query": {
        "metrics": [
          "sessions.count"
        ],
        "dimensions": [
          "country"
        ],
        "comparison": "none"
      },
      "chart": {
        "specVersion": 1,
        "type": "geo",
        "encoding": {
          "region": {
            "field": "country",
            "from": "primary"
          },
          "value": {
            "field": "sessions.count",
            "from": "primary"
          }
        },
        "options": {
          "map": "world"
        }
      }
    }
  ],
  "export": {
    "csv": true,
    "maxRows": 50000
  }
};
