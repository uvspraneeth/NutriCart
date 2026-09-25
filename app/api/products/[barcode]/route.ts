import { after, NextResponse } from 'next/server'
import { barcodeVariants } from '@/lib/barcode'
import { findInOpenFoodFacts } from '@/lib/openfoodfacts'
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server'

const COLUMNS = 'id, barcode, name, brand, category, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, image_url, aisle, is_active'

export async function GET(_request: Request, { params }: { params: Promise<{ barcode: string }> }) {
  const { barcode } = await params
  const normalized = barcode.replace(/[^0-9A-Za-z-]/g, '').slice(0, 64)

  if (!normalized) return NextResponse.json({ error: 'Invalid barcode' }, { status: 400 })

  // 1. Our own catalogue first: curated data wins.
  if (supabaseServer) {
    const { data, error } = await supabaseServer.from('products').select(COLUMNS).in('barcode', barcodeVariants(normalized)).limit(1).maybeSingle()
    if (error) console.error('[products] Supabase lookup failed:', error.message)
    else if (data) {
      // Staff hid this product (discontinued, recalled…): refuse it rather than falling back to Open Food Facts.
      if (!data.is_active) return NextResponse.json({ error: 'Product not sold here', barcode: normalized }, { status: 404 })
      const { is_active: _, ...product } = data
      return NextResponse.json({ product: { ...product, source: 'catalog', basis: 'catalog' } })
    }
  }

  // 2. Fall back to Open Food Facts (numeric retail codes only).
  if (!/^\d{8,14}$/.test(normalized)) return NextResponse.json({ error: 'Product not found', barcode: normalized }, { status: 404 })
  try {
    const product = await findInOpenFoodFacts(normalized)
    if (!product) return NextResponse.json({ error: 'Product not found', barcode: normalized }, { status: 404 })

    // 3. Warm our catalogue so the next scan is served locally (needs a service-role key; best effort).
    if (supabaseAdmin && !product.nutrition_missing) {
      after(async () => {
        const { error } = await supabaseAdmin!.from('products').insert({
          barcode: product.barcode, name: product.name, brand: product.brand, category: product.category, serving_size: product.serving_size,
          calories: product.calories, protein_g: product.protein_g, carbs_g: product.carbs_g, fat_g: product.fat_g, fiber_g: product.fiber_g, image_url: product.image_url,
        })
        if (error && error.code !== '23505') console.error('[products] Caching failed:', error.message)
      })
    }
    return NextResponse.json({ product })
  } catch (error) {
    console.error('[products] Open Food Facts lookup failed:', (error as Error).message)
    return NextResponse.json({ error: 'Product lookup failed' }, { status: 502 })
  }
}
