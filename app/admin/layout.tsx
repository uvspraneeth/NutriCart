import type { Metadata } from 'next'
import Link from 'next/link'
import { ShoppingBasket } from 'lucide-react'

export const metadata: Metadata = { title: 'NutriCart Staff', robots: { index: false, follow: false } }

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-shell admin-shell">
      <header className="admin-header">
        <Link href="/admin" className="brand"><div className="brand-mark"><ShoppingBasket size={22} strokeWidth={2.5} /></div><span>NutriCart</span><small className="staff-badge">Staff</small></Link>
      </header>
      {children}
    </main>
  )
}
