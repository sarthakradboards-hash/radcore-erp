'use client';

import { useEffect } from 'react';
import { listenForClientErrors } from './report.ts';

/** Mounted once in the root layout: every page's uncaught errors are reported (RC-158). Renders nothing. */
export function ClientErrorListener() {
  useEffect(() => listenForClientErrors(), []);
  return null;
}
