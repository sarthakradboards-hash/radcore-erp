import { z } from 'zod';
export const Line = z.object({ amount: z.coerce.number() });
