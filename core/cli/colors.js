// Module: CLI Color Utilities
// Description: Minimal ANSI color helpers for CLI output with automatic
//              fallback when colors are not supported.
// File: core/cli/colors.js

// Detect if ANSI colors should be disabled
const DISABLED =
  process.env.NO_COLOR ||
  process.env.TERM === 'dumb' ||
  !process.stdout.isTTY;

// Wrap helper
function wrap(code, s) {
  if (DISABLED) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

export const color = {
  red:   (s) => wrap(31, s),
  green: (s) => wrap(32, s),
  blue:  (s) => wrap(34, s),
  gray:  (s) => wrap(90, s),
  bold:  (s) => wrap(1, s)
};