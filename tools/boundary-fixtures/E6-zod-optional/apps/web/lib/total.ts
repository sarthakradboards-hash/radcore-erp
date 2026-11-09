import { z } from 'zod';
export const Line = z.object({ amount: z.optional(z.number()) });
