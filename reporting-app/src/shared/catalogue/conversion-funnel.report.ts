import type { ReportDefinitionInput } from '../schema/report-definition';

/** Built-in report: conversion-funnel */
export const conversionFunnel: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "conversion-funnel",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.conversionFunnel.title",
  "descriptionKey": "report.conversionFunnel.description",
  "category": "marketing",
  "audience": [
    "ecommerce-manager",
    "performance-marketing"
  ],
  "requiredCapabilities": {
    "metrics": [
      "sessions.count",
      "orders.count@orderdate"
    ],
    "sourceKinds": [
      "web-analytics",
      "commerce"
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
          "kpi-cvr"
        ]
      },
      {
        "id": "r1",
        "tileIds": [
          "funnel"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "kpi-cvr",
      "titleKey": "metric.conversion.rate",
      "span": 3,
      "query": {
        "metrics": [
          "conversion.rate"
        ],
        "dimensions": [],
        "comparison": "inherit"
      },
      "chart": {
        "specVersion": 1,
        "type": "kpi",
        "encoding": {
          "value": {
            "field": "conversion.rate",
            "from": "primary"
          },
          "compare": {
            "field": "conversion.rate",
            "from": "comparison"
          }
        },
        "options": {
          "goodDirection": "up"
        }
      }
    },
    {
      "id": "funnel",
      "titleKey": "report.conversionFunnel.funnel",
      "span": 12,
      "query": {
        "metrics": [
          "sessions.count",
          "productviews.count",
          "addtocart.count",
          "checkoutstart.count",
          "orders.count@orderdate"
        ],
        "dimensions": [],
        "comparison": "none"
      },
      "chart": {
        "specVersion": 1,
        "type": "funnel",
        "encoding": {
          "steps": [
            "sessions.count",
            "productviews.count",
            "addtocart.count",
            "checkoutstart.count",
            "orders.count@orderdate"
          ]
        },
        "options": {}
      }
    }
  ],
  "export": {
    "csv": true,
    "maxRows": 50000
  }
};
