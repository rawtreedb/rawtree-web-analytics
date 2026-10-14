// Chart palette as CSS variables in app/globals.css, so charts follow the theme.

export const chartColors = {
  primary: "var(--chart-primary)",
  success: "var(--chart-success)",
  info: "var(--chart-info)",
  muted: "var(--chart-muted)",
} as const;

export const categoricalColors = [
  "var(--chart-cat-1)",
  "var(--chart-cat-2)",
  "var(--chart-cat-3)",
  "var(--chart-cat-4)",
  "var(--chart-cat-5)",
  "var(--chart-cat-6)",
  "var(--chart-cat-7)",
] as const;
