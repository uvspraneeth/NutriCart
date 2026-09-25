import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { CsvImport } from '@/components/admin/csv-import'
import { requireStaff } from '@/lib/admin/session'

export default async function ImportPage() {
  await requireStaff()
  return (
    <section className="admin-screen">
      <Link href="/admin" className="back-link admin-back"><ArrowLeft size={16} /> All products</Link>
      <p className="eyebrow">BULK IMPORT</p>
      <h1 className="admin-title">Import products from CSV</h1>
      <p className="lead admin-lead">
        One row per barcode. Only <b>barcode</b> is required: blank cells are filled from Open Food Facts for new products,
        and for products you already have, only the filled columns are changed. Image links are downloaded and stored in your catalogue.
      </p>
      <CsvImport />
    </section>
  )
}
