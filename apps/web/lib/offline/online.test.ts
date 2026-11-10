// The online state heals: a wrong reading at load can't leave the banner up and saves paused (e2e on RAD-52).
import { onlineManager } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { watchOnline } from './online.ts';

const fakeWindow = (onLine: boolean) => Object.assign(new EventTarget(), { navigator: { onLine } });

afterEach(() => {
  vi.useRealTimers();
  onlineManager.setOnline(true);
});

it('takes the browser flag at start, and re-checks it once shortly after', () => {
  vi.useFakeTimers();
  const win = fakeWindow(false);
  const stop = watchOnline(win, 2000);
  expect(onlineManager.isOnline()).toBe(false);
  win.navigator.onLine = true; // the flag was wrong for a moment, and no online event came
  vi.advanceTimersByTime(2000);
  expect(onlineManager.isOnline()).toBe(true);
  stop();
});

it('re-checks on focus and pageshow', () => {
  const win = fakeWindow(true);
  const stop = watchOnline(win, 60_000);
  onlineManager.setOnline(false); // stuck offline, as in the e2e run
  win.dispatchEvent(new Event('focus'));
  expect(onlineManager.isOnline()).toBe(true);
  onlineManager.setOnline(false);
  win.dispatchEvent(new Event('pageshow'));
  expect(onlineManager.isOnline()).toBe(true);
  stop();
});

it('stops listening when stopped', () => {
  vi.useFakeTimers();
  const win = fakeWindow(true);
  watchOnline(win, 2000)();
  onlineManager.setOnline(false);
  win.dispatchEvent(new Event('focus'));
  vi.advanceTimersByTime(5000);
  expect(onlineManager.isOnline()).toBe(false);
});
