// The settings screens' row types, read off the contracts (RAD-133).
import type { listNumberSeries, listSettings } from '@radcore/lib-platform/contract';
import type { listPriceLists } from '@radcore/lib-sales/contract';
import type { z } from 'zod';

export type Setting = z.output<typeof listSettings.output>['settings'][number];
export type Series = z.output<typeof listNumberSeries.output>['series'][number];
export type PriceList = z.output<typeof listPriceLists.output>['items'][number];
