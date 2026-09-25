'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Smartphone } from 'lucide-react'
import { ANDROID_APP } from '@/lib/app-release'

const IN_APP_KEY = 'nc-in-app'

/** True inside the installed app: TWA launches with ?source=app and an android-app:// referrer; PWAs run standalone. */
function isInstalledApp() {
  try {
    if (new URLSearchParams(location.search).get('source') === 'app' || document.referrer.startsWith('android-app://')) sessionStorage.setItem(IN_APP_KEY, '1')
    return sessionStorage.getItem(IN_APP_KEY) === '1' || matchMedia('(display-mode: standalone)').matches
  } catch { return false }
}

/** "Get the Android app" link, only for Android browsers that aren't already the app. */
export function AndroidAppLink() {
  const [show, setShow] = useState(false)
  useEffect(() => { setShow(ANDROID_APP.available && /android/i.test(navigator.userAgent) && !isInstalledApp()) }, [])
  if (!show) return null
  return <Link href="/download" className="app-link"><Smartphone size={16} /> Get the Android app</Link>
}
