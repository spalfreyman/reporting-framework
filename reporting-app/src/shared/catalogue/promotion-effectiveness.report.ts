import type { ReportDefinitionInput } from '../schema/report-definition';

/** Built-in report: promotion-effectiveness */
export const promotionEffectiveness: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "promotion-effectiveness",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.promotionEffectiveness.title",
  "descriptionKey": "report.promotionEffectiveness.description",
  "category": "promotions",
  "audience": [
    "promotions-manager"
  ],
  "requiredCapabilities": {
    "metrics": [
      "orders.promoted@orderdate",
      "discount.redemptions"
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
      "dimension": "discountCode",
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
          "kpi-pen"
        ]
      },
      {
        "id": "r1",
        "tileIds": [
          "by-code"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "kpi-pen",
      "titleKey": "metric.promotion.penetration",
      "span": 3,
      "query": {
        "metrics": [
          "promotion.penetration"
        ],
        "dimensions": [],
        "comparison": "inherit"
      },
      "chart": {
        "specVersion": 1,
        "type": "kpi",
        "encoding": {
          "value": {
            "field": "promotion.penetration",
            "from": "primary"
          },
          "compare": {
            "field": "promotion.penetration",
            "from": "comparison"
          }
        },
        "options": {
          "goodDirection": "neutral"
        }
      }
    },
    {
      "id": "by-code",
      "titleKey": "report.promotionEffectiveness.byCode",
      "span": 12,
      "query": {
        "metrics": [
          "discount.redemptions",
          "orders.promoted@orderdate"
        ],
        "dimensions": [
          "discountCode"
        ],
        "comparison": "none",
        "topN": {
          "by": "discount.redemptions",
          "n": 25,
          "otherBucket": false
        },
        "orderBy": [
          {
            "column": "discount.redemptions",
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
              "field": "discountCode",
              "from": "primary"
            },
            {
              "field": "discount.redemptions",
              "from": "primary"
            },
            {
              "field": "orders.promoted@orderdate",
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
