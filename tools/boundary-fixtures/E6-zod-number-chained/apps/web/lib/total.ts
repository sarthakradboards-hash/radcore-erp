import { z } from 'zod';
export const Line = z.object({ taxRate: z.number().min(0) });
