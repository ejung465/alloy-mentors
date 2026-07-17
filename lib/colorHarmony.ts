// lib/colorHarmony.ts
// Small, dependency-free color-theory helpers for org branding.
// All math is plain HSL / sRGB — no native modules, safe for RN.

export type Hsl = { h: number; s: number; l: number };
export type HarmonySuggestion = { label: string; primary: string; secondary: string };

// ── Parsing helpers ────────────────────────────────────────────────

/** Normalize a user-typed hex ("#abc", "abc", "#AABBCC") to "#aabbcc", or null if unparseable. */
export function normalizeHex(hex: string): string | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    h = h.split('').map((c) => c + c).join('');
  }
  if (/^[0-9a-fA-F]{6}$/.test(h)) return '#' + h.toLowerCase();
  return null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Wrap a hue into [0, 360). */
function wrapHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

// ── Conversions ────────────────────────────────────────────────────

export function hexToHsl(hex: string): Hsl {
  const norm = normalizeHex(hex) ?? '#000000';
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
  }
  h = wrapHue(h);

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = wrapHue(h);
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return '#' + toHex(r) + toHex(g) + toHex(b);
}

// ── Harmony suggestions ────────────────────────────────────────────

// Keep suggested colors in a readable, brand-friendly band — never neon,
// never near-black or near-white.
const READABLE_S = { min: 45, max: 78 };
const READABLE_L = { min: 32, max: 55 };

function readable(h: number, s: number, l: number): string {
  return hslToHex(wrapHue(h), clamp(s, READABLE_S.min, READABLE_S.max), clamp(l, READABLE_L.min, READABLE_L.max));
}

/**
 * Given ONE base color, return 3 (primary, secondary) pairs using standard
 * color theory: complementary (180°), analogous (30°), split-complementary (150°/210°).
 * Saturation/lightness are kept in a readable range.
 */
export function suggestHarmonies(baseHex: string): HarmonySuggestion[] {
  const base = hexToHsl(baseHex);
  const primary = readable(base.h, base.s, base.l);

  return [
    {
      label: 'Complementary',
      primary,
      secondary: readable(base.h + 180, base.s, base.l),
    },
    {
      label: 'Analogous',
      primary,
      secondary: readable(base.h + 30, base.s, base.l),
    },
    {
      label: 'Split',
      primary,
      // split-complementary spans 150°/210°; use 150° as the paired accent.
      secondary: readable(base.h + 150, base.s, base.l - 4),
    },
  ];
}

// ── Contrast / accessibility ───────────────────────────────────────

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a hex color. */
export function relativeLuminance(hex: string): number {
  const norm = normalizeHex(hex) ?? '#000000';
  const r = srgbToLinear(parseInt(norm.slice(1, 3), 16));
  const g = srgbToLinear(parseInt(norm.slice(3, 5), 16));
  const b = srgbToLinear(parseInt(norm.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Shortest distance between two hues, in degrees (0..180). */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(wrapHue(a) - wrapHue(b));
  return d > 180 ? 360 - d : d;
}

/**
 * Advisory accessibility check for a primary/secondary pair.
 * Never blocks — just surfaces warnings.
 */
export function checkAccessibility(
  primary: string,
  secondary: string,
): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];

  const pOk = normalizeHex(primary);
  const sOk = normalizeHex(secondary);
  if (!pOk || !sOk) {
    if (!pOk) warnings.push('Primary color isn’t a valid hex value.');
    if (!sOk) warnings.push('Secondary color isn’t a valid hex value.');
    return { ok: false, warnings };
  }

  // White text on primary — the most common real-world usage (buttons, headers).
  const primaryOnWhiteText = contrastRatio(primary, '#FFFFFF');
  if (primaryOnWhiteText < 4.5) {
    warnings.push(
      `White text on your primary color has low contrast (${primaryOnWhiteText.toFixed(
        1,
      )}:1, aim for 4.5:1). It may be hard to read.`,
    );
  }

  // Primary vs secondary distinguishability.
  const pairContrast = contrastRatio(primary, secondary);
  const pHsl = hexToHsl(primary);
  const sHsl = hexToHsl(secondary);
  const dHue = hueDistance(pHsl.h, sHsl.h);
  const dLight = Math.abs(pHsl.l - sHsl.l);

  if (pairContrast < 1.5 && dHue < 25 && dLight < 12) {
    warnings.push('Your primary and secondary colors look almost identical — pick two that stand apart.');
  }

  return { ok: warnings.length === 0, warnings };
}
