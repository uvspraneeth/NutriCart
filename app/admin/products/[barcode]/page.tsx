import Link from 'next/link'
import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { ProductForm, type ProductDraft } from '@/components/admin/product-form'
import { findByBarcode } from '@/lib/admin/catalog'
import { normalizeBarcode } from '@/lib/admin/product-input'
import { requireStaff } from '@/lib/admin/session'
import { findInOpenFoodFacts } from '@/lib/openfoodfacts'

export default async function ProductPage({ params }: { params: Promise<{ barcode: string }> }) {
  await requireStaff()
  const { barcode: raw } = await params
  const barcode = normalizeBarcode(decodeURIComponent(raw))

  if (!barcode) {
    return (
      <section className="screen narrow-screen">
        <Link href="/admin" className="back-link"><ArrowLeft size={16} /> All products</Link>
        <p className="admin-alert"><TriangleAlert size={16} /> “{raw.slice(0, 20)}” isn’t a valid retail barcode (EAN-13, EAN-8 or UPC). Check the digits and try again.</p>
      </section>
    )
  }

  const existing = await findByBarcode(barcode)
  let draft: ProductDraft
  let source: 'catalog' | 'openfoodfacts' | 'manual' = 'catalog'
  if (existing) {
    draft = existing
  } else {
    // New product: pre-fill from Open Food Facts so staff only confirm details and add stock and aisle.
    const off = await findInOpenFoodFacts(barcode).catch(() => null)
    source = off ? 'openfoodfacts' : 'manual'
    draft = {
      barcode, name: off?.name ?? '', brand: off?.brand ?? null, category: off?.category ?? 'Grocery', serving_size: off?.serving_size ?? null,
      calories: off?.calories ?? 0, protein_g: off?.protein_g ?? 0, carbs_g: off?.carbs_g ?? 0, fat_g: off?.fat_g ?? 0, fiber_g: off?.fiber_g ?? 0,
      image_url: off?.image_url ?? null, stock: 0, aisle: null, is_active: true,
    }
  }

  return (
    <section className="screen admin-product">
      <Link href="/admin" className="back-link"><ArrowLeft size={16} /> All products</Link>
      <p className="eyebrow">{existing ? 'EDIT PRODUCT' : 'REGISTER PRODUCT'}</p>
      <h1>{existing ? existing.name : 'New product'}</h1>
      <p className="lead">
        {source === 'catalog' ? `Already registered. Barcode ${barcode}.`
          : source === 'openfoodfacts' ? 'Details filled in from Open Food Facts. Check them, then add stock and aisle.'
            : 'Not found in Open Food Facts. Enter the details from the pack.'}
      </p>
      <ProductForm product={draft} productId={existing?.id ?? null} />
    </section>
  )
}
