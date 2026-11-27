// Every library's settings and number series (RAD-132, ADR-001 §8c), composed here as routes are, since lib-platform
// imports no module, and the settings screens' routes built over them. tools/settings-admin.test.ts fails on a setting
// or series declared in a library and missing here.
import { series as accountsSeries, settings as accountsSettings } from '@radcore/lib-accounts';
import { settings as gstSettings } from '@radcore/lib-gst';
import { createSettingsScreens, series as platformSeries, settings as platformSettings } from '@radcore/lib-platform';
import { series as purchasingSeries, settings as purchasingSettings } from '@radcore/lib-purchasing';
import { series as salesSeries, settings as salesSettings } from '@radcore/lib-sales';
import { series as stockSeries, settings as stockSettings } from '@radcore/lib-stock';

export const API_SETTINGS = [...platformSettings, ...accountsSettings, ...gstSettings, ...salesSettings, ...stockSettings, ...purchasingSettings];
export const API_SERIES = [...platformSeries, ...accountsSeries, ...salesSeries, ...stockSeries, ...purchasingSeries];

/** GET and PUT /settings, GET /number-series and PUT /number-series/:key/prefix. */
export const settingsRoutes = createSettingsScreens(API_SETTINGS, API_SERIES).routes;
