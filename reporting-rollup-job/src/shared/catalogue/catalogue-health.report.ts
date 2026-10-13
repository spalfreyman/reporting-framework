import type { ReportDefinitionInput } from '../schema/report-definition.js';

/** Built-in report: catalogue-health */
export const catalogueHealth: ReportDefinitionInput = {
  "schemaVersion": 1,
  "id": "catalogue-health",
  "version": 1,
  "origin": "builtin",
  "titleKey": "report.catalogueHealth.title",
  "descriptionKey": "report.catalogueHealth.description",
  "category": "merchandising",
  "audience": [
    "merchandising-ops",
    "merchandiser"
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
      "valueSource": "ct-categories"
    },
    {
      "dimension": "productType",
      "ops": [
        "in"
      ],
      "multi": true,
      "valueSource": "dsp"
    }
  ],
  "freshness": {
    "maxAcceptableLagSeconds": 300,
    "showAsOf": true
  },
  "layout": {
    "rows": [
      {
        "id": "kpis",
        "tileIds": [
          "kpi-products",
          "kpi-variants"
        ]
      },
      {
        "id": "mix",
        "tileIds": [
          "by-category",
          "price-bands"
        ]
      },
      {
        "id": "detail",
        "tileIds": [
          "price-stats"
        ]
      }
    ]
  },
  "tiles": [
    {
      "id": "kpi-products",
      "titleKey": "metric.productsCount",
      "span": 6,
      "query": {
        "metrics": [
          "products.count"
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
            "field": "products.count",
            "from": "primary"
          }
        },
        "options": {
          "goodDirection": "neutral"
        }
      }
    },
    {
      "id": "kpi-variants",
      "titleKey": "metric.variantsCount",
      "span": 6,
      "query": {
        "metrics": [
          "variants.count"
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
            "field": "variants.count",
            "from": "primary"
          }
        },
        "options": {
          "goodDirection": "neutral"
        }
      }
    },
    {
      "id": "by-category",
      "titleKey": "report.catalogueHealth.byCategory",
      "span": 6,
      "query": {
        "metrics": [
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
        "topN": {
          "by": "products.count",
          "n": 15,
          "otherBucket": true
        }
      },
      "chart": {
        "specVersion": 1,
        "type": "breakdown",
        "encoding": {
          "category": {
            "field": "category"
          },
          "y": [
            {
              "field": "products.count",
              "mark": "bar"
            }
          ]
        },
        "options": {
          "showDataLabels": true
        }
      }
    },
    {
      "id": "price-bands",
      "titleKey": "report.catalogueHealth.priceBands",
      "span": 6,
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
            "field": "priceBand"
          },
          "value": {
            "field": "products.count"
          }
        },
        "options": {
          "yZero": true
        }
      }
    },
    {
      "id": "price-stats",
      "titleKey": "report.catalogueHealth.priceStats",
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
              "field": "category"
            },
            {
              "field": "products.count"
            },
            {
              "field": "price.min"
            },
            {
              "field": "price.mean"
            },
            {
              "field": "price.max"
            }
          ]
        },
        "options": {
          "pageSize": 25,
          "totalsRow": false
        }
      }
    }
  ],
  "export": {
    "csv": true,
    "maxRows": 50000
  }
};
