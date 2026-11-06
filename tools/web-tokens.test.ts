// Contrast of the web app's colour tokens (M1-41, RC-189, WCAG 2.2 AA), in light and in dark.
// Text needs 4.5:1 (1.4.3); control edges and the focus ring need 3:1 (1.4.11).
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync('apps/web/styles/tokens.css', 'utf8');
const HEX = '#[0-9a-fA-F]{6}';
const tokens = new Map(
  [...css.matchAll(new RegExp(`--([\\w-]+):\\s*light-dark\\((${HEX}),\\s*(${HEX})\\)`, 'g'))]
    .map(([, name, light, dark]) => [name!, { light: light!, dark: dark! }]),
);

const channel = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const BACKGROUNDS = ['surface', 'surface-raised'];
const PAIRS: [fg: string, bg: string, min: number][] = [
  ...['text', 'text-muted', 'accent', 'danger', 'ok', 'warn'].flatMap((fg) =>
    BACKGROUNDS.map((bg): [string, string, number] => [fg, bg, 4.5])),
  ['text', 'surface-selected', 4.5],
  ['text-muted', 'surface-selected', 4.5],
  ['on-accent', 'accent', 4.5],
  ...['border-field', 'focus'].flatMap((fg) =>
    [...BACKGROUNDS, 'surface-selected'].map((bg): [string, string, number] => [fg, bg, 3])),
];
const DECORATIVE = new Set(['border-subtle']);

it('meets WCAG AA contrast for every token pair, in light and dark', () => {
  const failures = PAIRS.flatMap(([fg, bg, min]) => (['light', 'dark'] as const).flatMap((mode) => {
    const f = tokens.get(fg)?.[mode];
    const b = tokens.get(bg)?.[mode];
    if (!f || !b) return [`${mode} ${fg} on ${bg}: token missing`];
    const ratio = contrast(f, b);
    return ratio >= min ? [] : [`${mode} ${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`];
  }));
  expect(failures).toEqual([]);
});

it('checks every colour token, so a new one cannot skip the contrast test', () => {
  const paired = new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]));
  expect([...tokens.keys()].filter((t) => !paired.has(t) && !DECORATIVE.has(t))).toEqual([]);
  // Every colour declared in the file is a light-dark() pair the regex above read.
  expect(css.match(/--[\w-]+:\s*(#|rgb|hsl|oklch|light-dark)/g)?.length).toBe(tokens.size);
});

it('computes contrast the WCAG way', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  expect(contrast('#64748b', '#ffffff')).toBeCloseTo(4.76, 2); // v1's muted text on white
  expect(contrast('#ffffff', '#ffffff')).toBe(1);
});
