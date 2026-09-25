'use client'

import { useEffect } from 'react'

/** Registers the service worker in production (installability + offline page). Dev stays SW-free to avoid stale caches. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
  }, [])
  return null
}
