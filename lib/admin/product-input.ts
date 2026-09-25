// Product field rules shared by the single-product form, the CSV import preview (browser) and the import action (server).
import { isValidGtin, toGtin13 } from '@/lib/barcode'

export const NUTRIENT_FIELDS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'] as const
const TEXT_LIMITS = { name: 120, brand: 80, category: 60, serving_size: 40, aisle: 40, image_url: 500 } as const
type TextField = keyof typeof TEXT_LIMITS
type NutrientField = typeof NUTRIENT_FIELDS[number]

export const PRODUCT_COLUMNS = ['barcode', 'name', 'brand', 'category', 'serving_size', ...NUTRIENT_FIELDS, 'image_url', 'stock', 'aisle', 'active'] as const
export type ProductColumn = typeof PRODUCT_COLUMNS[number]

export type ProductInput = { barcode: string } & Partial<Record<TextField, string | null> & Record<NutrientField | 'stock', number> & { is_active: boolean }>
export type ParsedInput = { value: ProductInput | null; errors: Record<string, string> }

const ALIASES: Record<string, ProductColumn> = {
  ean: 'barcode', gtin: 'barcode', upc: 'barcode', code: 'barcode', product_name: 'name', title: 'name',
  kcal: 'calories', energy: 'calories', energy_kcal: 'calories', protein: 'protein_g', proteins: 'protein_g', carbs: 'carbs_g',
  carbohydrates: 'carbs_g', fat: 'fat_g', fiber: 'fiber_g', fibre: 'fiber_g', fibre_g: 'fiber_g', serving: 'serving_size',
  image: 'image_url', image_link: 'image_url', photo: 'image_url', qty: 'stock', quantity: 'stock', units: 'stock',
  shelf: 'aisle', location: 'aisle', is_active: 'active', available: 'active',
}

/** Maps a CSV header ("Protein (g)", "Image URL", "Qty") to a product column, or null if unknown. */
export function resolveHeader(header: string): ProductColumn | null {
  const key = header.trim().toLowerCase().replace(/\(g\)|\(kcal\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return (PRODUCT_COLUMNS as readonly string[]).includes(key) ? key as ProductColumn : ALIASES[key] ?? null
}

/** Digits only, check digit valid, stored as GTIN-13 when it's a 12-digit UPC-A. Null when it isn't a retail barcode. */
export function normalizeBarcode(raw: string) {
  const code = raw.replace(/\D/g, '')
  return isValidGtin(code) ? toGtin13(code) : null
}

function isHttpUrl(text: string) {
  try {
    const url = new URL(text)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch { return false }
}

const TRUE = ['yes', 'y', 'true', '1', 'on', 'active']
const FALSE = ['no', 'n', 'false', '0', 'off', 'hidden', 'inactive']

/**
 * `partial` (CSV): blank cells are left out so an update only touches filled columns.
 * Full (form): blanks become defaults and a name is required.
 */
export function parseProductInput(get: (key: ProductColumn) => string | null | undefined, { partial }: { partial: boolean }): ParsedInput {
  const errors: Record<string, string> = {}
  const raw = (key: ProductColumn) => String(get(key) ?? '').trim()
  const barcode = normalizeBarcode(raw('barcode'))
  if (!barcode) errors.barcode = raw('barcode') ? 'Not a valid retail barcode (EAN-13, EAN-8 or UPC).' : 'Barcode is required.'
  const value: ProductInput = { barcode: barcode ?? '' }

  for (const [key, max] of Object.entries(TEXT_LIMITS) as Array<[TextField, number]>) {
    const text = raw(key)
    if (text.length > max) errors[key] = `Keep it under ${max} characters.`
    if (text) value[key] = text
    else if (!partial) value[key] = key === 'category' ? 'Grocery' : null
  }
  if (!partial && !value.name) errors.name = 'Name is required.'
  if (value.image_url && !isHttpUrl(value.image_url)) errors.image_url = 'Use a full http(s):// image link.'

  const number = (key: NutrientField | 'stock', max: number, integer = false) => {
    const text = raw(key).replace(',', '.')
    if (!text) { if (!partial) value[key] = 0; return }
    const n = Number(text)
    if (!Number.isFinite(n) || n < 0 || n > max || (integer && !Number.isInteger(n))) errors[key] = `Enter ${integer ? 'a whole number' : 'a number'} from 0 to ${max}.`
    else value[key] = integer ? n : Math.round(n * 10) / 10
  }
  NUTRIENT_FIELDS.forEach(key => number(key, key === 'calories' ? 100_000 : 10_000))
  number('stock', 1_000_000, true)

  const active = raw('active').toLowerCase()
  if (TRUE.includes(active)) value.is_active = true
  else if (FALSE.includes(active)) value.is_active = false
  else if (active) errors.active = 'Use yes or no.'
  else if (!partial) value.is_active = false

  return { value: Object.keys(errors).length ? null : value, errors }
}
