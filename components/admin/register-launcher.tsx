'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ScanLine } from 'lucide-react'
import { BarcodeScanner, primeScannerFeedback } from '@/components/barcode-scanner'

/** Opens the camera scanner in pick mode; the scanned barcode opens its register/edit page. */
export function RegisterLauncher() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="scan-button" onClick={() => { primeScannerFeedback(); setOpen(true) }}>
        <ScanLine size={22} /> Scan to register
        <small>or type a barcode</small>
      </button>
      {open && <BarcodeScanner mode="pick" onPick={code => router.push(`/admin/products/${code}`)} onClose={() => setOpen(false)} />}
    </>
  )
}
