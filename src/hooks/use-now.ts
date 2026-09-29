'use client';

import { useSyncExternalStore } from 'react';

// One shared 1-second clock for every countdown on the page.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(cb: () => void) {
  listeners.add(cb);
  timer ??= setInterval(() => {
    now = Date.now();
    for (const l of listeners) l();
  }, 1000);
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useNow() {
  return useSyncExternalStore(subscribe, () => now, () => 0);
}
