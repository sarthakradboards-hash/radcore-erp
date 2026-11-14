// A branded array spread into Math.max: each amount becomes a float (the auditor on #159).
import type { Money } from '@radcore/lib-common';

export const peak = (xs: readonly Money[]) => Math.max(...xs);
