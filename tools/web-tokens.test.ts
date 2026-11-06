// Contrast of the web app's colour tokens (M1-41, RC-189, WCAG 2.2 AA), in light and in dark.
// Text needs 4.5:1 (1.4.3); control edges and the focus ring need 3:1 (1.4.11).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Pair = { light: string; dark: string };
type Decl = { block: string; name: string; value: string };

// Every declaration with the blocks around it ("@media x :root"). Comments are dropped first.
const declarations = (css: string): Decl[] => {
  const out: Decl[] = [];
  const stack: string[] = [];
  let buf = '';
  const flush = () => {
    const s = buf.trim();
    buf = '';
    if (!s) return;
    const i = s.indexOf(':');
    out.push({ block: stack.join(' '), name: s.slice(0, i).trim(), value: s.slice(i + 1).trim() });
  };
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (ch === '{') { stack.push(buf.trim()); buf = ''; }
    else if (ch === '}') { flush(); stack.pop(); }
    else if (ch === ';') flush();
    else buf += ch;
  }
  return out;
};

const HEX = '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})';
const COLOUR = new RegExp(`^light-dark\\(\\s*(${HEX})\\s*,\\s*(${HEX})\\s*\\)$`);
const LENGTH = /^-?(?:\d+|\d*\.\d+)(?:rem|em|px|%)?$/;
const expand = (hex: string): string => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex);

// Colour tokens per block. Anything that isn't a colour pair, a length, a number or a font list is an error,
// so a color-mix(), var(), named, alpha or other colour can't slip past the contrast check.
const read = (css: string) => {
  const blocks = new Map<string, Map<string, Pair>>();
  const errors: string[] = [];
  for (const { block, name, value } of declarations(css)) {
    const colour = COLOUR.exec(value);
    if (colour) {
      if (!blocks.has(block)) blocks.set(block, new Map());
      blocks.get(block)!.set(name.slice(2), { light: expand(colour[1]!), dark: expand(colour[2]!) });
    } else if (!name.startsWith('--') || !(LENGTH.test(value) || name.startsWith('--font-'))) {
      errors.push(`${block} { ${name}: ${value} } is not a light-dark() pair of opaque hex colours, a length, a number or a font list`);
    }
  }
  return { blocks, errors };
};

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

// Every block that sets a colour is checked with :root's tokens plus its own overrides.
const check = (css: string): string[] => {
  const { blocks, errors } = read(css);
  const root = blocks.get(':root') ?? new Map<string, Pair>();
  const paired = new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]));
  for (const [block, own] of blocks) {
    const tokens = new Map([...root, ...own]);
    for (const name of own.keys()) {
      if (!paired.has(name) && !DECORATIVE.has(name)) errors.push(`${block} --${name} is in no contrast pair`);
    }
    for (const [fg, bg, min] of PAIRS) {
      for (const mode of ['light', 'dark'] as const) {
        const f = tokens.get(fg)?.[mode];
        const b = tokens.get(bg)?.[mode];
        if (!f || !b) { errors.push(`${block} ${mode} ${fg} on ${bg}: token missing`); continue; }
        const ratio = contrast(f, b);
        if (ratio < min) errors.push(`${block} ${mode} ${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);
      }
    }
  }
  return errors;
};

const css = readFileSync('apps/web/styles/tokens.css', 'utf8');

it('meets WCAG AA contrast for every token pair, in light and dark, and every token is checkable', () => {
  expect(check(css)).toEqual([]);
});

describe('the token guard', () => {
  const root = css.slice(0, css.indexOf('}') + 1);
  const withRoot = (extra: string) => check(root.replace(/}\s*$/, `${extra}\n}`));

  it.each([
    ['--tint: color-mix(in srgb, red, blue);'], ['--alias: var(--text);'], ['--x: red;'], ['--x: transparent;'],
    ['--x: hwb(0 0% 0%);'], ['--x: lab(50 0 0);'], ['--x: lch(50 0 0);'], ['--x: light-dark(#ff000080, #000);'],
    ['--x: light-dark(rgb(0 0 0), #fff);'], ['color: red;'],
  ])('refuses %s and names it', (decl) => {
    expect(withRoot(decl).join('\n')).toContain(decl.slice(0, decl.indexOf(':')));
  });

  it('refuses a new colour token in no pair', () => {
    expect(withRoot('--new: light-dark(#000, #fff);')).toEqual([':root --new is in no contrast pair']);
  });

  it('checks an override in another block against :root', () => {
    expect(check(`${root}\n@media (prefers-contrast: more) { :root { --text-muted: light-dark(#999, #a7b0bf); } }`))
      .toContain('@media (prefers-contrast: more) :root light text-muted on surface: 2.63 < 4.5');
  });

  it('ignores comments and accepts 3-digit hex and spaces inside light-dark()', () => {
    expect(withRoot('/* --old: red; */ --surface-raised: light-dark( #fff , #18202b );')).toEqual([]);
  });
});

it('computes contrast the WCAG way', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  expect(contrast('#64748b', '#ffffff')).toBeCloseTo(4.76, 2); // v1's muted text on white
  expect(contrast('#ffffff', '#ffffff')).toBe(1);
});
