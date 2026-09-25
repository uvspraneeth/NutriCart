import { toGtin13 } from '@/lib/barcode'

export type Nutrients = { calories: number; protein: number; carbs: number; fat: number; fiber: number }
export type NutrientKey = keyof Nutrients
export type Product = Nutrients & {
  id: string | number
  barcode?: string
  name: string
  brand?: string | null
  category: string
  serving_size?: string | null
  image_url?: string | null
  accent: string
  nutriscore?: string | null
  /** What the nutrient numbers describe: a whole pack, one serving, 100 g, or our own catalogue's convention. */
  basis?: 'package' | 'serving' | '100g' | 'catalog'
  source?: 'catalog' | 'openfoodfacts'
  nutritionMissing?: boolean
  aisle?: string | null
}
export type CartItem = Product & { quantity: number }

export const NUTRIENTS: Array<{ key: NutrientKey; label: string; unit: string; color: string }> = [
  { key: 'calories', label: 'Calories', unit: 'kcal', color: 'orange' },
  { key: 'protein', label: 'Protein', unit: 'g', color: 'green' },
  { key: 'carbs', label: 'Carbs', unit: 'g', color: 'yellow' },
  { key: 'fat', label: 'Fat', unit: 'g', color: 'purple' },
  { key: 'fiber', label: 'Fiber', unit: 'g', color: 'blue' },
]

const NUTRISCORE_ACCENT: Record<string, string> = { a: '#3f8f54', b: '#86b883', c: '#d9ad4f', d: '#d7773c', e: '#c4553a' }

export type LookupResult =
  | { status: 'found'; product: Product }
  | { status: 'not-found'; barcode: string }
  | { status: 'error'; message: string }

type ApiProduct = {
  id: string | number; barcode?: string; name: string; brand?: string | null; category?: string | null; serving_size?: string | null
  calories: number | string; protein_g: number | string; carbs_g: number | string; fat_g: number | string; fiber_g: number | string
  image_url?: string | null; nutriscore_grade?: string | null; basis?: Product['basis']; source?: Product['source']; nutrition_missing?: boolean
  aisle?: string | null
}

const toNumber = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0 }

function fromApi(p: ApiProduct): Product {
  return {
    id: p.id,
    barcode: p.barcode,
    name: p.name,
    brand: p.brand,
    category: p.category || 'Grocery',
    serving_size: p.serving_size,
    calories: toNumber(p.calories),
    protein: toNumber(p.protein_g),
    carbs: toNumber(p.carbs_g),
    fat: toNumber(p.fat_g),
    fiber: toNumber(p.fiber_g),
    image_url: p.image_url,
    nutriscore: p.nutriscore_grade,
    accent: NUTRISCORE_ACCENT[p.nutriscore_grade ?? ''] ?? '#86b883',
    basis: p.basis,
    source: p.source,
    nutritionMissing: p.nutrition_missing,
    aisle: p.aisle,
  }
}

export async function lookupProduct(code: string, signal?: AbortSignal): Promise<LookupResult> {
  try {
    const response = await fetch(`/api/products/${encodeURIComponent(code)}`, { signal })
    const body = await response.json().catch(() => ({}))
    if (response.status === 404) return { status: 'not-found', barcode: code }
    if (!response.ok || !body.product) return { status: 'error', message: 'The product database is not responding. Try again in a moment.' }
    return { status: 'found', product: fromApi(body.product) }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    return { status: 'error', message: 'You seem to be offline. Check your connection and try again.' }
  }
}

/** Items in the cart are matched by barcode first so the same product from different sources merges. */
export const productKey = (p: Pick<Product, 'barcode' | 'id'>) => p.barcode ? toGtin13(p.barcode.replace(/^0+(?=\d{12})/, '')) : String(p.id)
