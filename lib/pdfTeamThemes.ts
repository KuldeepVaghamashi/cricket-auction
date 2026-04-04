/**
 * Distinct per-team PDF themes for auction result sheets.
 * Uses golden-angle hue steps so neighboring indices stay visually different.
 */

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export type PdfTeamThemeColors = {
  colorPrimary: string;
  colorSecondary: string;
  colorAccent: string;
  /** Bid / points column + footer total */
  colorPoints: string;
};

/** ~137.5° per step spreads hues evenly around the wheel for any team count. */
const GOLDEN_ANGLE = 137.508;

/**
 * One theme per ordinal within the auction (0 = first team when sorted).
 * Guarantees a different hue step each time; saturation/lightness tuned for dark PDF backgrounds.
 */
export function getPdfThemeForTeamIndex(index: number): PdfTeamThemeColors {
  const baseHue = (index * GOLDEN_ANGLE) % 360;
  return {
    colorPrimary: hslToHex(baseHue, 74, 46),
    colorSecondary: hslToHex((baseHue + 48) % 360, 62, 34),
    colorAccent: hslToHex((baseHue + 14) % 360, 78, 58),
    colorPoints: hslToHex((baseHue + 105) % 360, 68, 56),
  };
}
