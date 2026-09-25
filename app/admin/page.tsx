import Link from 'next/link'
import { EyeOff, FileUp, LogOut, PackageSearch, Search } from 'lucide-react'
import { logout } from '@/app/admin/actions'
import { RegisterLauncher } from '@/components/admin/register-launcher'
import { listProducts, LOW_STOCK, type CatalogFilter } from '@/lib/admin/catalog'
import { requireStaff } from '@/lib/admin/session'

const FILTERS: Array<{ value: CatalogFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'low-stock', label: `Low stock (≤${LOW_STOCK})` },
  { value: 'hidden', label: 'Hidden' },
]

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  await requireStaff()
  const { q = '', filter: rawFilter } = await searchParams
  const filter = FILTERS.some(f => f.value === rawFilter) ? rawFilter as CatalogFilter : 'all'
  const products = await listProducts({ q, filter })
  const href = (next: CatalogFilter) => `/admin?${new URLSearchParams({ ...(q && { q }), ...(next !== 'all' && { filter: next }) })}`

  return (
    <section className="admin-screen">
      <div className="cart-heading admin-heading">
        <div>
          <p className="eyebrow">STORE CATALOGUE</p>
          <h1>Products</h1>
          <p className="lead">Register each product once by its barcode. Every can of the same item shares one barcode, so stock is just a count.</p>
        </div>
        <div className="admin-actions">
          <RegisterLauncher />
          <Link href="/admin/import" className="scanner-pill"><FileUp size={14} /> Import CSV</Link>
        </div>
      </div>

      <div className="admin-toolbar">
        <form className="admin-search" action="/admin">
          <Search size={16} />
          <input name="q" defaultValue={q} placeholder="Search name, brand or barcode" aria-label="Search products" />
          {filter !== 'all' && <input type="hidden" name="filter" value={filter} />}
        </form>
        <nav className="segmented admin-filters" aria-label="Filter products">
          {FILTERS.map(f => <Link key={f.value} href={href(f.value)} className={filter === f.value ? 'active' : ''}>{f.label}</Link>)}
        </nav>
        <form action={logout}><button className="scanner-pill"><LogOut size={14} /> Sign out</button></form>
      </div>

      {products.length === 0 ? (
        <div className="items-card empty-cart"><div><PackageSearch size={30} /><p>{q || filter !== 'all' ? 'No products match.' : 'No products yet. Scan one to register it.'}</p></div></div>
      ) : (
        <ul className="items-card admin-list">
          {products.map(p => (
            <li key={p.id}>
              <Link href={`/admin/products/${p.barcode}`} className={`item-row admin-row ${p.is_active ? '' : 'hidden-product'}`}>
                <div className="food-dot">{p.image_url ? <img src={p.image_url} alt="" /> : <PackageSearch size={18} />}</div>
                <div className="item-name">
                  <b>{p.name}</b>
                  <small>{[p.brand, p.barcode, p.aisle].filter(Boolean).join(' · ')}</small>
                </div>
                {!p.is_active && <span className="item-count"><EyeOff size={12} /> Hidden</span>}
                <span className={`stock-pill ${p.stock <= LOW_STOCK ? 'low' : ''}`}>{p.stock} in stock</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
