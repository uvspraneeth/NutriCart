// Retail barcode helpers (EAN-13, EAN-8, UPC-A, UPC-E), shared by the scanner and the lookup API.

/** GS1 mod-10 check-digit validation for GTIN-8/12/13/14. Rejects most camera misreads. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false
  const digits = code.split('').map(Number)
  const check = digits.pop()!
  const sum = digits.reverse().reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

/** Expands an 8-digit UPC-E code to its 12-digit UPC-A form, which product databases index by. */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null
  const [ns, d1, d2, d3, d4, d5, d6, check] = code
  let body: string
  if ('012'.includes(d6)) body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`
  const upcA = `${ns}${body}${check}`
  return isValidGtin(upcA) ? upcA : null
}

/**
 * The same product can be stored as UPC-A (12 digits) or EAN-13 (leading zero),
 * so lookups try every equivalent form.
 */
export function barcodeVariants(code: string): string[] {
  const variants = new Set([code])
  if (/^\d+$/.test(code)) {
    const trimmed = code.replace(/^0+/, '')
    if (trimmed.length >= 8) {
      variants.add(trimmed)
      if (trimmed.length <= 12) variants.add(trimmed.padStart(12, '0'))
      if (trimmed.length <= 13) variants.add(trimmed.padStart(13, '0'))
    }
  }
  return [...variants]
}

/** Canonical GTIN-13 form used for external lookups (UPC-A gets a leading zero). */
export function toGtin13(code: string): string {
  return /^\d{12}$/.test(code) ? `0${code}` : code
}
