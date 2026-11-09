// E6 finds money by name (ADR-001). For every word, each spelling of the name must fire the rule, and the controls
// must not. A word added to MONEY_WORDS is covered here without a new fixture.
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { MONEY_WORDS, SUFFIX_ONLY } from '../eslint.config.mjs';

const eslint = new ESLint();
const fires = async (name: string) => {
  const [r] = await eslint.lintText(`export const f = (${name}: string) => Number(${name}) * 2;\n`,
    { filePath: 'apps/web/lib/probe.ts' });
  return (r?.messages ?? []).some((m) => m.ruleId === 'radcore/e6-no-float-money');
};
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const snake = (w: string) => w.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

describe('E6 money words', () => {
  it.each(MONEY_WORDS)('%s fires as a name, a camelCase, ALL-CAPS or snake_case ending, and a plural', async (w) => {
    for (const name of [w, `${w}s`, `line${cap(w)}`, `line${w.toUpperCase()}`, `line_${snake(w)}`, w.toUpperCase()]) {
      expect(await fires(name), name).toBe(true);
    }
  });

  it.each(SUFFIX_ONLY)('%s fires only as a camelCase ending', async (w) => {
    expect(await fires(`credit${cap(w)}`)).toBe(true);
    for (const name of [w, w.toUpperCase(), `MAX_${w.toUpperCase()}`]) expect(await fires(name), name).toBe(false);
  });

  it.each(['generate', 'separate', 'iterate', 'count', 'index', 'width', 'internet', 'planet'])('%s does not fire', async (n) => {
    expect(await fires(n)).toBe(false);
  });
});
