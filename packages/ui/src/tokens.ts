export const brandColors = {
  purple: "#852890",
  plum: "#400044",
  gradient: "linear-gradient(135deg, #852890 0%, #400044 100%)"
} as const;

export const seasonalColors = {
  spring: "#93c83e",
  summer: "#56cbf5",
  autumn: "#fbad18",
  winter: "#e01a36"
} as const;

export const semanticColors = {
  textPrimary: "#201827",
  textMuted: "#635b6b",
  borderDefault: "#d8d1dd",
  focusRing: "#852890",
  statusSuccess: "#2e7d4f",
  statusWarning: "#a86100",
  statusDanger: "#b4233a",
  statusInfo: "#16689a"
} as const;

export const density = {
  comfortable: {
    controlHeight: "44px",
    paddingX: "16px",
    paddingY: "12px",
    gap: "16px"
  },
  compact: {
    controlHeight: "34px",
    paddingX: "12px",
    paddingY: "8px",
    gap: "10px"
  }
} as const;

export const radii = {
  xs: "4px",
  sm: "6px",
  md: "8px",
  lg: "12px"
} as const;

export const shadows = {
  raised: "0 10px 30px rgba(32, 24, 39, 0.08)",
  overlay: "0 22px 60px rgba(32, 24, 39, 0.18)"
} as const;

export const typography = {
  ui: "Avenir Next, Avenir, Inter, Segoe UI, Arial, sans-serif",
  editorial:
    "VAG Rounded, Nunito Sans, Arial Rounded MT Bold, Avenir Next, Arial, sans-serif",
  mono: "SFMono-Regular, Consolas, Liberation Mono, monospace"
} as const;
