import 'server-only'
import { toGtin13 } from '@/lib/barcode'

const OFF_FIELDS = 'code,product_name,generic_name,brands,categories_tags,quantity,product_quantity,serving_size,serving_quantity,nutriments,image_front_small_url,image_front_url,nutriscore_grade'

type OffProduct = {
  code: string
  product_name?: string
  generic_name?: string
  brands?: string
  categories_tags?: string[]
  quantity?: string
  product_quantity?: number | string
  serving_size?: string
  serving_quantity?: number | string
  nutriments?: Record<string, number | string | undefined>
  image_front_small_url?: string
  image_front_url?: string
  nutriscore_grade?: string
}

function num(value: unknown) {
  const n = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

const round = (value: number) => Math.round(value * 10) / 10

function humanizeCategory(tags?: string[]) {
  const tag = [...(tags ?? [])].reverse().find(t => t.startsWith('en:'))
  if (!tag) return 'Grocery'
  const label = tag.slice(3).replace(/-/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// Open Food Facts reports nutrients per 100 g/ml. A shopping cart holds whole packs, so scale to the
// package size when known, falling back to one serving, then to 100 g.
export type OffLookup = ReturnType<typeof fromOpenFoodFacts>

function fromOpenFoodFacts(p: OffProduct) {
  const n = p.nutriments ?? {}
  const kcal100 = num(n['energy-kcal_100g']) ?? (num(n['energy_100g']) !== null ? num(n['energy_100g'])! / 4.184 : null)
  const per100 = { calories: kcal100, protein: num(n.proteins_100g), carbs: num(n.carbohydrates_100g), fat: num(n.fat_100g), fiber: num(n.fiber_100g) }

  const packGrams = num(p.product_quantity)
  const servingGrams = num(p.serving_quantity)
  const [factor, basis, amount] =
    packGrams && packGrams <= 20000 ? [packGrams / 100, 'package', p.quantity || `${packGrams} g`]
      : servingGrams ? [servingGrams / 100, 'serving', p.serving_size || `${servingGrams} g`]
        : [1, '100g', '100 g']

  return {
    id: `off-${p.code}`,
    barcode: p.code,
    name: p.product_name || p.generic_name || 'Unnamed product',
    brand: p.brands?.split(',')[0]?.trim() || null,
    category: humanizeCategory(p.categories_tags),
    serving_size: amount,
    calories: Math.round((per100.calories ?? 0) * factor),
    protein_g: round((per100.protein ?? 0) * factor),
    carbs_g: round((per100.carbs ?? 0) * factor),
    fat_g: round((per100.fat ?? 0) * factor),
    fiber_g: round((per100.fiber ?? 0) * factor),
    image_url: p.image_front_small_url || p.image_front_url || null,
    nutriscore_grade: p.nutriscore_grade && 'abcde'.includes(p.nutriscore_grade) ? p.nutriscore_grade : null,
    nutrition_missing: Object.values(per100).every(v => v === null),
    basis,
    source: 'openfoodfacts',
  }
}

export async function findInOpenFoodFacts(code: string) {
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${toGtin13(code)}.json?fields=${OFF_FIELDS}`, {
    headers: { 'User-Agent': 'NutriCart/0.1 (barcode lookup)' },
    signal: AbortSignal.timeout(7000),
    next: { revalidate: 60 * 60 * 24 },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Open Food Facts responded ${response.status}`)
  const body = await response.json() as { status: number; product?: OffProduct }
  return body.status === 1 && body.product ? fromOpenFoodFacts({ ...body.product, code: body.product.code || code }) : null
}
