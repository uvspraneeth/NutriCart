import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Download, ShieldCheck, ShoppingBasket, Smartphone } from 'lucide-react'
import { ANDROID_APP } from '@/lib/app-release'

export const metadata: Metadata = { title: 'Get the NutriCart Android app' }

export default function DownloadPage() {
  return (
    <main className="app-shell">
      <header><div className="brand"><div className="brand-mark"><ShoppingBasket size={22} strokeWidth={2.5} /></div><span>NutriCart</span></div></header>
      <section className="screen narrow-screen download-screen">
        <Link href="/" className="back-link"><ArrowLeft size={16} /> Back to NutriCart</Link>
        <div className="eyebrow">ANDROID APP</div>
        <h1>NutriCart in your <em>pocket</em>.</h1>
        <p className="lead">Full-screen scanning with your phone’s main camera, straight from your home screen.</p>
        {ANDROID_APP.available ? (
          <a className="primary-action download-button" href={ANDROID_APP.apk} download>
            <Download size={20} /> Download for Android <small>v{ANDROID_APP.version} · APK</small>
          </a>
        ) : (
          <p className="admin-alert"><Smartphone size={16} /> The Android app is being prepared. Check back soon.</p>
        )}
        <ol className="install-steps">
          <li><b>Download</b> the file, then tap it in your notifications or Downloads.</li>
          <li>If Android asks, allow your browser to <b>install unknown apps</b> (Settings opens automatically).</li>
          <li>Tap <b>Install</b>, then open NutriCart and allow the camera when you first scan.</li>
        </ol>
        <p className="hint download-note"><ShieldCheck size={14} /> Signed by NutriCart. Requires Android 7 or later with Chrome installed.</p>
      </section>
    </main>
  )
}
