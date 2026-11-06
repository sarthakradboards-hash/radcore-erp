import { defineRoute } from '@radcore/lib-platform';
import * as sales from '@radcore/lib-sales';
import { createOrder } from '@radcore/lib-sales/contract';
export default [defineRoute(createOrder, sales.createOrder)];
