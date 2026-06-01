import type { Severity } from "../core/types.js";

const codes = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
};

export interface Colorizer {
  bold: (value: string) => string;
  dim: (value: string) => string;
  severity: (severity: Severity, value: string) => string;
  gray: (value: string) => string;
}

export function createColorizer(enabled: boolean): Colorizer {
  const wrap = (open: string, value: string) => enabled ? `${open}${value}${codes.reset}` : value;
  return {
    bold: (value) => wrap(codes.bold, value),
    dim: (value) => wrap(codes.dim, value),
    gray: (value) => wrap(codes.gray, value),
    severity: (severity, value) => {
      if (severity === "high") return wrap(codes.red, value);
      if (severity === "medium") return wrap(codes.yellow, value);
      if (severity === "info") return wrap(codes.cyan, value);
      return value;
    },
  };
}
