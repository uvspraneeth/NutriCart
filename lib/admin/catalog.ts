import 'server-only'
import { barcodeVariants } from '@/lib/barcode'
import { supabaseAdmin } from '@/lib/supabase/server'

export type CatalogProduct = {
  id: number
  barcode: string
  name: string
  brand: string | null
  category: string
  serving_size: string | null
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  image_url: string | null
  stock: number
  aisle: string | null
  is_active: boolean
  updated_at: string
}

export type CatalogFilter = 'all' | 'low-stock' | 'hidden'
export const LOW_STOCK = 5

const COLUMNS = 'id, barcode, name, brand, category, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, image_url, stock, aisle, is_active, updated_at'

// supabase-js returns numeric columns as strings; the admin UI wants numbers.
function fromRow(row: Record<string, unknown>): CatalogProduct {
  const n = (key: string) => Number(row[key] ?? 0)
  return { ...(row as CatalogProduct), calories: n('calories'), protein_g: n('protein_g'), carbs_g: n('carbs_g'), fat_g: n('fat_g'), fiber_g: n('fiber_g') }
}

export async function listProducts({ q = '', filter = 'all' }: { q?: string; filter?: CatalogFilter }) {
  let query = supabaseAdmin!.from('products').select(COLUMNS).order('updated_at', { ascending: false }).limit(200)
  // Strip characters that have meaning inside a PostgREST `or=(…)` filter.
  const term = q.replace(/[,()*%\\:"]/g, ' ').trim().slice(0, 60)
  if (term) query = query.or(`name.ilike.*${term}*,brand.ilike.*${term}*,barcode.ilike.*${term}*`)
  if (filter === 'low-stock') query = query.lte('stock', LOW_STOCK)
  if (filter === 'hidden') query = query.eq('is_active', false)
  const { data, error } = await query
  if (error) throw new Error(`Couldn’t load products: ${error.message}`)
  return (data ?? []).map(fromRow)
}

/** Finds a product under any equivalent form of its barcode (UPC-A vs EAN-13), so re-scans never create duplicates. */
export async function findByBarcode(barcode: string) {
  return (await findByBarcodes([barcode]))[0] ?? null
}

/** Batch form of findByBarcode for imports: one query for many barcodes. */
export async function findByBarcodes(barcodes: string[]) {
  if (!barcodes.length) return []
  const { data, error } = await supabaseAdmin!.from('products').select(COLUMNS).in('barcode', [...new Set(barcodes.flatMap(barcodeVariants))])
  if (error) throw new Error(`Couldn’t load products: ${error.message}`)
  return (data ?? []).map(fromRow)
}
