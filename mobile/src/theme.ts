/* Generated from packages/design-tokens/tokens.json. Do not edit by hand. */

export const theme = {
  "color": {
    "ink": {
      "300": "#A89A8C",
      "500": "#7A6B5E",
      "700": "#4A3D33",
      "800": "#33291F",
      "900": "#211A15",
      "950": "#16110E"
    },
    "field": {
      "0": "#FFFFFF",
      "50": "#FAF8F5",
      "100": "#F2EEE8",
      "200": "#E6E0D7",
      "300": "#D2C9BC"
    },
    "gold": {
      "50": "#FBF3E2",
      "100": "#F5E4C0",
      "300": "#DDB35A",
      "500": "#C08A2E",
      "600": "#9A6B1C",
      "700": "#7A5314"
    },
    "kola": {
      "50": "#E8F1EC",
      "300": "#5A9C82",
      "600": "#1B6B4F",
      "800": "#12503B",
      "900": "#0C3A2A"
    },
    "harmattan": {
      "100": "#FBEFD5",
      "500": "#D9A31E",
      "600": "#8A6408"
    },
    "laterite": {
      "100": "#FAE6E1",
      "600": "#A93B23"
    },
    "lagoon": {
      "100": "#E3EBF4",
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
    "20": "80px",
    "24": "96px",
    "32": "128px",
    "base": "4px"
  },
  "radius": {
    "none": "0px",
    "xs": "4px",
    "sm": "6px",
    "md": "10px",
    "lg": "16px",
    "xl": "24px",
    "stamp": "2px",
    "pill": "999px"
  },
  "border": {
    "hairline": "1px",
    "emphasis": "2px",
    "stamp": "3px"
  },
  "elevation": {
    "flat": "none",
    "raised": "0 1px 2px rgba(33,26,21,0.06), 0 1px 1px rgba(33,26,21,0.04)",
    "lifted": "0 4px 12px -2px rgba(33,26,21,0.10), 0 2px 4px -2px rgba(33,26,21,0.06)",
    "floating": "0 12px 28px -6px rgba(33,26,21,0.16), 0 4px 10px -4px rgba(33,26,21,0.08)",
    "sheet": "0 -1px 0 0 #E6E0D7, 0 -8px 32px -12px rgba(33,26,21,0.22)",
    "modal": "0 24px 56px -12px rgba(33,26,21,0.28)"
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
      "exit": "cubic-bezier(0.3, 0, 0.8, 0.15)",
      "spring": "cubic-bezier(0.34, 1.4, 0.64, 1)"
    }
  },
  "type": {
    "display-1": {
      "size": "56px",
      "lineHeight": "58px",
      "weight": "600",
      "tracking": "-0.03em",
      "family": "display"
    },
    "display-2": {
      "size": "40px",
      "lineHeight": "44px",
      "weight": "600",
      "tracking": "-0.025em",
      "family": "display"
    },
    "display-3": {
      "size": "32px",
      "lineHeight": "38px",
      "weight": "600",
      "tracking": "-0.02em",
      "family": "display"
    },
    "title-1": {
      "size": "24px",
      "lineHeight": "30px",
      "weight": "600",
      "tracking": "-0.015em",
      "family": "display"
    },
    "title-2": {
      "size": "20px",
      "lineHeight": "27px",
      "weight": "600",
      "tracking": "-0.01em",
      "family": "body"
    },
    "body-lg": {
      "size": "18px",
      "lineHeight": "28px",
      "weight": "400",
      "tracking": "-0.005em",
      "family": "body"
    },
    "body": {
      "size": "16px",
      "lineHeight": "25px",
      "weight": "400",
      "tracking": "0",
      "family": "body"
    },
    "body-strong": {
      "size": "16px",
      "lineHeight": "25px",
      "weight": "600",
      "tracking": "0",
      "family": "body"
    },
    "caption": {
      "size": "14px",
      "lineHeight": "21px",
      "weight": "400",
      "tracking": "0",
      "family": "body"
    },
    "caption-strong": {
      "size": "14px",
      "lineHeight": "21px",
      "weight": "600",
      "tracking": "0",
      "family": "body"
    },
    "label": {
      "size": "12px",
      "lineHeight": "16px",
      "weight": "600",
      "tracking": "0.08em",
      "family": "body"
    },
    "amount-xl": {
      "size": "40px",
      "lineHeight": "44px",
      "weight": "600",
      "tracking": "-0.025em",
      "family": "display",
      "numeric": true
    },
    "amount-lg": {
      "size": "28px",
      "lineHeight": "32px",
      "weight": "600",
      "tracking": "-0.02em",
      "family": "body",
      "numeric": true
    },
    "amount": {
      "size": "16px",
      "lineHeight": "22px",
      "weight": "500",
      "tracking": "-0.005em",
      "family": "body",
      "numeric": true
    },
    "code": {
      "size": "14px",
      "lineHeight": "20px",
      "weight": "500",
      "tracking": "0.02em",
      "family": "mono"
    }
  },
  "family": {},
  "targetMin": 48
} as const;

export type Theme = typeof theme;
export type ColorName = keyof typeof theme.color;
