// E6 finds money by name (ADR-001). For every word, each spelling of the name must fire the rule, and the controls
// must not. A word added to MONEY_WORDS is covered here without a new fixture.
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { MONEY_WORDS } from '../eslint.config.mjs';

// The name half only: the probe path isn't on disk, so it's in no tsconfig and gets no type information. The typed
// half has its own fixtures (tools/boundary-fixtures/E6-branded-*, RAD-67).
const eslint = new ESLint({ overrideConfig: { languageOptions: { parserOptions: { projectService: false } },
  rules: { 'radcore/e6-branded-money': 'off' } } });
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

  // RAD-67: a credit limit is money; every other limit is a number (the false positive on #51).
  it.each(['limit', 'LIMIT', 'MAX_LIMIT', 'retryLimit', 'rateLimit', 'timeLimit', 'sizeLimit'])('%s does not fire', async (n) => {
    expect(await fires(n)).toBe(false);
  });

  it.each(['generate', 'separate', 'iterate', 'count', 'index', 'width', 'internet', 'planet'])('%s does not fire', async (n) => {
    expect(await fires(n)).toBe(false);
  });
});
