// Minimal RFC 4180 CSV: quoted fields, "" escapes, CRLF/LF, UTF-8 BOM, comma or semicolon (Excel in many locales).

export function detectDelimiter(text: string) {
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  const count = (ch: string) => firstLine.split(ch).length - 1
  return count(';') > count(',') ? ';' : ','
}

export function parseCsv(input: string, delimiter = detectDelimiter(input)): string[][] {
  const text = input.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === delimiter) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  // Drop blank lines (a trailing newline, or empty rows Excel leaves behind).
  return rows.filter(r => r.some(cell => cell.trim() !== ''))
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>) {
  const cell = (value: string | number | null | undefined) => {
    const s = value == null ? '' : String(value)
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
