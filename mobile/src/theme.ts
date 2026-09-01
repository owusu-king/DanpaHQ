/* Generated from packages/design-tokens/tokens.json. Do not edit by hand. */

export const theme = {
  "color": {
    "ink": {
      "300": "#9AA5A1",
      "500": "#5C6B66",
      "700": "#2B3A35",
      "900": "#101A17"
    },
    "field": {
      "0": "#FFFFFF",
      "50": "#F7F6F1",
      "100": "#EFEDE5",
      "200": "#DFDCD1",
      "300": "#C7C3B5"
    },
    "kola": {
      "50": "#E6F0ED",
      "300": "#4E9484",
      "600": "#0B5D4E",
      "800": "#084438",
      "900": "#062F27"
    },
    "harmattan": {
      "100": "#FBF0D2",
      "500": "#D9A31E",
      "600": "#8A6408"
    },
    "laterite": {
      "100": "#F8E4DF",
      "600": "#A93B23"
    },
    "lagoon": {
      "100": "#E1EBF5",
      "600": "#2F5E8C"
    }
  },
  "space": {
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "5": "20px",
    "6": "24px",
    "8": "32px",
    "10": "40px",
    "12": "48px",
    "16": "64px",
    "base": "4px"
  },
  "radius": {
    "none": "0px",
    "sm": "4px",
    "md": "8px",
    "lg": "12px",
    "stamp": "2px",
    "pill": "999px"
  },
  "border": {
    "hairline": "1px",
    "emphasis": "2px",
    "stamp": "3px"
  },
  "motion": {
    "duration": {
      "instant": "80ms",
      "fast": "140ms",
      "base": "220ms",
      "slow": "320ms"
    },
    "easing": {
      "standard": "cubic-bezier(0.2, 0, 0, 1)",
      "enter": "cubic-bezier(0.05, 0.7, 0.1, 1)",
      "exit": "cubic-bezier(0.3, 0, 0.8, 0.15)"
    }
  },
  "type": {
    "display-1": {
      "size": "40px",
      "lineHeight": "44px",
      "weight": "600",
      "tracking": "-0.02em"
    },
    "display-2": {
      "size": "32px",
      "lineHeight": "36px",
      "weight": "600",
      "tracking": "-0.02em"
    },
    "title-1": {
      "size": "24px",
      "lineHeight": "30px",
      "weight": "600",
      "tracking": "-0.01em"
    },
    "title-2": {
      "size": "20px",
      "lineHeight": "26px",
      "weight": "600",
      "tracking": "-0.01em"
    },
    "body": {
      "size": "16px",
      "lineHeight": "24px",
      "weight": "400",
      "tracking": "0"
    },
    "body-strong": {
      "size": "16px",
      "lineHeight": "24px",
      "weight": "600",
      "tracking": "0"
    },
    "caption": {
      "size": "14px",
      "lineHeight": "20px",
      "weight": "400",
      "tracking": "0"
    },
    "label": {
      "size": "12px",
      "lineHeight": "16px",
      "weight": "600",
      "tracking": "0.06em"
    },
    "amount-lg": {
      "size": "32px",
      "lineHeight": "36px",
      "weight": "500",
      "tracking": "-0.01em"
    },
    "amount": {
      "size": "16px",
      "lineHeight": "22px",
      "weight": "500",
      "tracking": "0"
    }
  },
  "family": {
    "display": "'Bricolage Grotesque Variable', 'Public Sans', system-ui, sans-serif",
    "body": "'Public Sans Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    "mono": "'IBM Plex Mono', ui-monospace, 'Roboto Mono', monospace"
  },
  "targetMin": 48
} as const;

export type Theme = typeof theme;
export type ColorName = keyof typeof theme.color;
