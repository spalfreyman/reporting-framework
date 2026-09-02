import type { ReportDefinitionInput } from '../schema/report-definition';

/** Built-in report: fulfilment-sla */
export const fulfilmentSla: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "fulfilment-sla",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.fulfilmentSla.title",
  "descriptionKey": "report.fulfilmentSla.description",
  "category": "operations",
  "audience": [
    "operations-manager"
  ],
  "requiredCapabilities": {
    "metrics": [
      "shipments.count",
      "shipments.onTime"
    ],
    "sourceKinds": [
      "oms",
      "erp"
    ],
    "permissions": []
  },
  "optionalMetrics": [
    "dispatch.onTimeRate"
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
      "dimension": "warehouse",
      "ops": [
        "in"
      ],
      "multi": true,
      "required": false,
      "valueSource": "dsp"
    },
    {
      "dimension": "carrier",
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
          "kpi-ontime"
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
          "by-carrier"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "kpi-ontime",
      "titleKey": "metric.dispatch.onTimeRate",
      "span": 3,
      "query": {
        "metrics": [
          "dispatch.onTimeRate"
        ],
        "dimensions": [],
        "comparison": "inherit"
      },
      "chart": {
        "specVersion": 1,
        "type": "kpi",
        "encoding": {
          "value": {
            "field": "dispatch.onTimeRate",
            "from": "primary"
          },
          "compare": {
            "field": "dispatch.onTimeRate",
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
      "titleKey": "report.fulfilmentSla.trend",
      "span": 12,
      "query": {
        "metrics": [
          "shipments.count",
          "shipments.onTime"
        ],
        "dimensions": [],
        "grain": "inherit",
        "comparison": "none"
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
              "field": "shipments.count",
              "from": "primary",
              "mark": "bar"
            },
            {
              "field": "shipments.onTime",
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
      "id": "by-carrier",
      "titleKey": "report.fulfilmentSla.byCarrier",
      "span": 12,
      "query": {
        "metrics": [
          "shipments.count",
          "shipments.onTime"
        ],
        "dimensions": [
          "carrier"
        ],
        "comparison": "none",
        "orderBy": [
          {
            "column": "shipments.count",
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
              "field": "carrier",
              "from": "primary"
            },
            {
              "field": "shipments.count",
              "from": "primary"
            },
            {
              "field": "shipments.onTime",
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
