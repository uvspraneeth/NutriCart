'use client'

import { useActionState, useState, useTransition } from 'react'
import { Check, LoaderCircle, Minus, PackageSearch, Plus, TriangleAlert } from 'lucide-react'
import { adjustStock, saveProduct, type SaveState } from '@/app/admin/actions'
import type { CatalogProduct } from '@/lib/admin/catalog'

export type ProductDraft = Omit<CatalogProduct, 'id' | 'updated_at'>

const NUTRIENTS = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
  { key: 'fiber_g', label: 'Fiber', unit: 'g' },
] as const
const STOCK_STEPS = [-1, 1, 6, 24]

export function ProductForm({ product, productId }: { product: ProductDraft; productId: number | null }) {
  const [state, formAction, saving] = useActionState(saveProduct, {} as SaveState)
  const [stock, setStock] = useState(String(product.stock))
  const [image, setImage] = useState(product.image_url ?? '')
  const [stockError, setStockError] = useState('')
  const [adjusting, startAdjust] = useTransition()
  const error = (key: string) => state.errors?.[key] && <small className="admin-error">{state.errors[key]}</small>

  function bump(delta: number) {
    if (!productId) return
    startAdjust(async () => {
      const result = await adjustStock(productId, delta)
      if ('stock' in result) { setStock(String(result.stock)); setStockError('') } else setStockError(result.error)
    })
  }

  return (
    <form action={formAction} className="admin-form">
      <input type="hidden" name="barcode" value={product.barcode} />
      <div className="form-panel">
        <div className="admin-identity">
          <div className="result-thumb admin-thumb">{image ? <img src={image} alt="" /> : <PackageSearch size={24} />}</div>
          <div className="result-body"><small>Barcode</small><b>{product.barcode}</b></div>
        </div>
        <label>Name *<input name="name" defaultValue={product.name} required maxLength={120} />{error('name')}</label>
        <div className="field-row admin-row-even">
          <label>Brand<input name="brand" defaultValue={product.brand ?? ''} maxLength={80} /></label>
          <label>Category<input name="category" defaultValue={product.category} maxLength={60} /></label>
        </div>
        <div className="field-row admin-row-even">
          <label>Nutrition is for<input name="serving_size" defaultValue={product.serving_size ?? ''} placeholder="e.g. 250 ml (whole can)" maxLength={40} /></label>
          <label>Aisle / shelf<input name="aisle" defaultValue={product.aisle ?? ''} placeholder="e.g. Aisle 4, Drinks" maxLength={40} /></label>
        </div>
        <label>Image link<input name="image_url" type="url" value={image} onChange={e => setImage(e.target.value)} placeholder="https://…" maxLength={500} />{error('image_url')}</label>
      </div>

      <div className="form-panel">
        <div className="card-title">Nutrition</div>
        <div className="admin-nutrients">
          {NUTRIENTS.map(({ key, label, unit }) => (
            <label key={key}>{label} <span>({unit})</span><input name={key} type="number" min="0" step="0.1" inputMode="decimal" defaultValue={product[key]} />{error(key)}</label>
          ))}
        </div>
      </div>

      <div className="form-panel">
        <div className="card-title">Stock</div>
        <div className="admin-stock">
          <label>Units on hand<input name="stock" type="number" min="0" step="1" inputMode="numeric" value={stock} onChange={e => setStock(e.target.value)} />{error('stock')}</label>
          {productId && (
            <div className="admin-stock-steps" aria-label="Quick stock change">
              {STOCK_STEPS.map(step => (
                <button type="button" key={step} className="scanner-pill" disabled={adjusting} onClick={() => bump(step)}>
                  {step < 0 ? <Minus size={13} /> : <Plus size={13} />}{Math.abs(step)}
                </button>
              ))}
            </div>
          )}
        </div>
        {stockError && <small className="admin-error">{stockError}</small>}
        <label className="admin-toggle"><input name="is_active" type="checkbox" defaultChecked={product.is_active} /> Available to shoppers <span>Untick to hide a discontinued or recalled product from scans.</span></label>
      </div>

      <div className="admin-save">
        {state.message && <p className={state.ok ? 'admin-success' : 'admin-error'} role="status">{state.ok ? <Check size={16} /> : <TriangleAlert size={16} />} {state.message}</p>}
        <button className="primary-action" disabled={saving}>{saving ? <LoaderCircle className="spin" size={18} /> : productId ? 'Save changes' : 'Register product'}</button>
      </div>
    </form>
  )
}
