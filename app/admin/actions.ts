'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { findByBarcode, findByBarcodes, type CatalogProduct } from '@/lib/admin/catalog'
import { isRehosted, rehostImage } from '@/lib/admin/images'
import { normalizeBarcode, NUTRIENT_FIELDS, parseProductInput, type ProductColumn } from '@/lib/admin/product-input'
import { checkPin, createSession, deleteSession, requireStaff } from '@/lib/admin/session'
import { findInOpenFoodFacts } from '@/lib/openfoodfacts'
import { supabaseAdmin } from '@/lib/supabase/server'

export type LoginState = { error?: string }

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const result = await checkPin(String(formData.get('pin') ?? '').slice(0, 64))
  if (!result.ok) return { error: result.error }
  await createSession()
  redirect('/admin')
}

export async function logout() {
  await deleteSession()
  redirect('/admin/login')
}

export type SaveState = { ok?: boolean; message?: string; errors?: Record<string, string> }

export async function saveProduct(_prev: SaveState, formData: FormData): Promise<SaveState> {
  await requireStaff()
  // The form's checkbox is `is_active`; the shared parser calls the column `active`.
  const { value, errors } = parseProductInput(key => key === 'active' ? (formData.get('is_active') ? 'yes' : 'no') : formData.get(key)?.toString(), { partial: false })
  if (!value) return { errors, message: 'Fix the highlighted fields.' }

  // Update whichever row already holds this barcode (in any equivalent form), otherwise insert.
  const existing = await findByBarcode(value.barcode)
  if (value.image_url && value.image_url !== existing?.image_url && !isRehosted(value.image_url)) {
    const image = await rehostImage(value.image_url, value.barcode)
    if (!image.ok) return { errors: { image_url: `Couldn’t use this image: ${image.reason}.` }, message: 'Fix the highlighted fields.' }
    value.image_url = image.url
  }
  const { error } = existing
    ? await supabaseAdmin!.from('products').update(value).eq('id', existing.id)
    : await supabaseAdmin!.from('products').insert(value)
  if (error) {
    console.error('[admin] Save failed:', error.message)
    return { message: error.code === '23505' ? 'Another product already uses this barcode.' : 'Couldn’t save. Try again.' }
  }
  revalidatePath('/admin', 'layout')
  return { ok: true, message: existing ? 'Changes saved.' : 'Product registered.' }
}

// ---- CSV import ----

export type ImportRow = { row: number; cells: Partial<Record<ProductColumn, string>> }
export type ImportResult = { row: number; barcode: string; status: 'added' | 'updated' | 'unchanged' | 'failed'; message?: string; imageWarning?: string }

const IMPORT_BATCH = 20
const matchKey = (barcode: string) => barcode.replace(/^0+/, '')

/** Which of these barcodes are already registered (for the import preview). */
export async function checkBarcodes(barcodes: string[]) {
  await requireStaff()
  const valid = [...new Set(barcodes.slice(0, 2000).map(b => normalizeBarcode(String(b))).filter((b): b is string => Boolean(b)))]
  const found = new Set<string>()
  // Chunked: each barcode expands to several variants and PostgREST filters travel in the URL.
  for (let i = 0; i < valid.length; i += 200) {
    for (const product of await findByBarcodes(valid.slice(i, i + 200))) found.add(matchKey(product.barcode))
  }
  return valid.filter(b => found.has(matchKey(b)))
}

async function importOne({ row, cells }: ImportRow, existingByKey: Map<string, CatalogProduct>, seen: Set<string>): Promise<ImportResult> {
  const { value, errors } = parseProductInput(key => cells[key], { partial: true })
  const barcode = value?.barcode ?? String(cells.barcode ?? '')
  if (!value) return { row, barcode, status: 'failed', message: Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join(' ') }
  if (seen.has(matchKey(value.barcode))) return { row, barcode, status: 'failed', message: 'Duplicate barcode in this file.' }
  seen.add(matchKey(value.barcode))

  const existing = existingByKey.get(matchKey(value.barcode))
  const { barcode: _, image_url: csvImage, ...fields } = value
  let imageWarning: string | undefined
  let image: string | undefined
  if (csvImage && csvImage !== existing?.image_url) {
    const hosted = isRehosted(csvImage) ? { ok: true as const, url: csvImage } : await rehostImage(csvImage, value.barcode)
    if (hosted.ok) image = hosted.url
    else imageWarning = `Image skipped: ${hosted.reason}.`
  }

  if (existing) {
    const changes = { ...fields, ...(image && { image_url: image }) }
    if (!Object.keys(changes).length) return { row, barcode: existing.barcode, status: 'unchanged', imageWarning }
    const { error } = await supabaseAdmin!.from('products').update(changes).eq('id', existing.id)
    if (error) { console.error('[import] Update failed:', error.message); return { row, barcode, status: 'failed', message: 'Couldn’t update this product.' } }
    return { row, barcode: existing.barcode, status: 'updated', imageWarning }
  }

  // New product: fill whatever the CSV left blank from Open Food Facts. CSV values always win.
  const off = await findInOpenFoodFacts(value.barcode).catch(() => null)
  const nutrition = NUTRIENT_FIELDS.every(key => fields[key] === undefined) ? off : null
  const insert = {
    barcode: value.barcode,
    name: fields.name ?? off?.name,
    brand: fields.brand ?? off?.brand ?? null,
    category: fields.category ?? off?.category ?? 'Grocery',
    serving_size: fields.serving_size ?? off?.serving_size ?? null,
    ...Object.fromEntries(NUTRIENT_FIELDS.map(key => [key, fields[key] ?? nutrition?.[key] ?? 0])),
    image_url: image ?? off?.image_url ?? null,
    stock: fields.stock ?? 0,
    aisle: fields.aisle ?? null,
    is_active: fields.is_active ?? true,
  }
  if (!insert.name) return { row, barcode, status: 'failed', message: 'Name missing and not found in Open Food Facts.' }
  const { error } = await supabaseAdmin!.from('products').insert(insert)
  if (error) {
    console.error('[import] Insert failed:', error.message)
    return { row, barcode, status: 'failed', message: error.code === '23505' ? 'Already registered (added meanwhile).' : 'Couldn’t add this product.' }
  }
  return { row, barcode: value.barcode, status: 'added', imageWarning }
}

/** Imports up to 20 CSV rows. The client calls this batch by batch to show progress and stay under request limits. */
export async function importBatch(rows: ImportRow[]): Promise<ImportResult[]> {
  await requireStaff()
  const batch = rows.slice(0, IMPORT_BATCH).map(r => ({ row: Number(r.row) || 0, cells: typeof r.cells === 'object' && r.cells ? r.cells : {} }))
  const barcodes = batch.map(r => normalizeBarcode(String(r.cells.barcode ?? ''))).filter((b): b is string => Boolean(b))
  const existingByKey = new Map((await findByBarcodes(barcodes)).map(p => [matchKey(p.barcode), p]))
  const seen = new Set<string>()
  const results: ImportResult[] = new Array(batch.length)
  // Three at a time: image downloads and Open Food Facts lookups dominate, and OFF asks clients to stay gentle.
  let next = 0
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < batch.length) {
      const i = next++
      results[i] = await importOne(batch[i], existingByKey, seen).catch(error => {
        console.error('[import] Row failed:', (error as Error).message)
        return { row: batch[i].row, barcode: String(batch[i].cells.barcode ?? ''), status: 'failed' as const, message: 'Unexpected error.' }
      })
    }
  }))
  revalidatePath('/admin', 'layout')
  return results
}

export async function adjustStock(id: number, delta: number) {
  await requireStaff()
  if (!Number.isInteger(id) || !Number.isInteger(delta) || Math.abs(delta) > 10_000) return { error: 'Invalid change.' }
  const { data, error } = await supabaseAdmin!.rpc('adjust_product_stock', { p_id: id, p_delta: delta })
  if (error) { console.error('[admin] Stock change failed:', error.message); return { error: 'Couldn’t update stock.' } }
  revalidatePath('/admin', 'layout')
  return { stock: data as number }
}
