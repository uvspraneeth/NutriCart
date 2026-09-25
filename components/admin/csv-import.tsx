'use client'

import { useRef, useState } from 'react'
import { Check, Download, FileSpreadsheet, LoaderCircle, RotateCcw, TriangleAlert, Upload } from 'lucide-react'
import { checkBarcodes, importBatch, type ImportResult, type ImportRow } from '@/app/admin/actions'
import { parseProductInput, resolveHeader, type ProductColumn } from '@/lib/admin/product-input'
import { parseCsv, toCsv } from '@/lib/csv'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 2000
const BATCH = 20

type Status = 'new' | 'update' | 'error' | 'duplicate'
type PreviewRow = ImportRow & { raw: string[]; barcode: string; status: Status; message?: string }
type Phase = 'idle' | 'checking' | 'ready' | 'importing' | 'done'

const STATUS_LABEL: Record<Status | ImportResult['status'], string> = {
  new: 'New', update: 'Update', error: 'Error', duplicate: 'Duplicate in file', added: 'Added', updated: 'Updated', unchanged: 'No changes', failed: 'Failed',
}

export function CsvImport() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState('')
  const [header, setHeader] = useState<string[]>([])
  const [ignored, setIgnored] = useState<string[]>([])
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [results, setResults] = useState<Map<number, ImportResult>>(new Map())
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setPhase('idle'); setFileName(''); setFileError(''); setHeader([]); setIgnored([]); setRows([]); setResults(new Map())
    if (inputRef.current) inputRef.current.value = ''
  }

  async function load(file: File) {
    reset()
    setFileName(file.name)
    if (file.size > MAX_BYTES) return setFileError('This file is over 2 MB. Split it into smaller files.')
    const table = parseCsv(await file.text())
    if (table.length < 2) return setFileError('No product rows found. The first line must be the column headers.')
    const [head, ...body] = table
    if (body.length > MAX_ROWS) return setFileError(`This file has ${body.length} rows; the limit is ${MAX_ROWS}. Split it into smaller files.`)
    const columns = head.map(resolveHeader)
    if (!columns.includes('barcode')) return setFileError('Missing a “barcode” column. Download the template to see the expected headers.')
    setHeader(head)
    setIgnored(head.filter((_, i) => !columns[i] && head[i].trim()))

    const seen = new Set<string>()
    const preview = body.map((raw, index): PreviewRow => {
      const cells: Partial<Record<ProductColumn, string>> = {}
      columns.forEach((column, i) => { if (column && raw[i]?.trim()) cells[column] = raw[i].trim() })
      const { value, errors } = parseProductInput(key => cells[key], { partial: true })
      const row = index + 2 // spreadsheet line number (header is line 1)
      if (!value) return { row, cells, raw, barcode: cells.barcode ?? '', status: 'error', message: Object.values(errors).join(' ') }
      const key = value.barcode.replace(/^0+/, '')
      if (seen.has(key)) return { row, cells, raw, barcode: value.barcode, status: 'duplicate', message: 'This barcode appears earlier in the file; this row will be skipped.' }
      seen.add(key)
      return { row, cells, raw, barcode: value.barcode, status: 'new' }
    })
    setRows(preview)
    setPhase('checking')
    try {
      const existing = new Set((await checkBarcodes(preview.filter(r => r.status === 'new').map(r => r.barcode))).map(b => b.replace(/^0+/, '')))
      setRows(preview.map(r => r.status === 'new' && existing.has(r.barcode.replace(/^0+/, '')) ? { ...r, status: 'update' } : r))
      setPhase('ready')
    } catch {
      setFileError('Couldn’t check which products already exist. Check your connection and try again.')
      setPhase('idle')
    }
  }

  async function runImport() {
    const todo = rows.filter(r => r.status === 'new' || r.status === 'update')
    setPhase('importing')
    const done = new Map<number, ImportResult>()
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH)
      try {
        for (const result of await importBatch(batch.map(({ row, cells }) => ({ row, cells })))) done.set(result.row, result)
      } catch {
        batch.forEach(r => done.set(r.row, { row: r.row, barcode: r.barcode, status: 'failed', message: 'Network or server error; try this row again.' }))
      }
      setResults(new Map(done))
    }
    setPhase('done')
  }

  function downloadErrors() {
    const failed = rows.filter(r => r.status === 'error' || r.status === 'duplicate' || results.get(r.row)?.status === 'failed')
    const csv = toCsv([[...header, 'error'], ...failed.map(r => [...header.map((_, i) => r.raw[i] ?? ''), results.get(r.row)?.message ?? r.message ?? ''])])
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: fileName.replace(/\.csv$/i, '') + '-errors.csv' })
    link.click()
    URL.revokeObjectURL(url)
  }

  const count = (status: Status) => rows.filter(r => r.status === status).length
  const importable = count('new') + count('update')
  const tally = (status: ImportResult['status']) => [...results.values()].filter(r => r.status === status).length
  const imageWarnings = [...results.values()].filter(r => r.imageWarning).length
  const failures = count('error') + count('duplicate') + tally('failed')
  const progress = importable ? (results.size / importable) * 100 : 0

  return (
    <div className="csv-import">
      {phase === 'idle' && (
        <label
          className={`csv-drop ${dragging ? 'dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file) void load(file) }}
        >
          <Upload size={28} />
          <b>Drop a CSV file here, or click to choose</b>
          <small>UTF-8, comma or semicolon separated · up to {MAX_ROWS} rows</small>
          <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={e => { const file = e.target.files?.[0]; if (file) void load(file) }} />
        </label>
      )}
      {phase === 'idle' && <a className="scanner-pill csv-template" href="/templates/products-template.csv" download><Download size={14} /> Download template</a>}
      {fileError && <p className="admin-alert" role="alert"><TriangleAlert size={16} /> {fileError}</p>}

      {rows.length > 0 && (
        <div className="items-card csv-preview">
          <div className="card-title">
            <span><FileSpreadsheet size={16} /> {fileName}</span>
            <button className="scanner-pill" onClick={reset} disabled={phase === 'importing'}><RotateCcw size={13} /> Choose another file</button>
          </div>

          <div className="csv-chips">
            {phase === 'checking' ? <span className="item-count"><LoaderCircle className="spin" size={12} /> Checking catalogue…</span> : phase !== 'done' && phase !== 'importing' ? <>
              <span className="csv-chip new">{count('new')} new</span>
              <span className="csv-chip update">{count('update')} update</span>
              {count('error') > 0 && <span className="csv-chip error">{count('error')} with errors</span>}
              {count('duplicate') > 0 && <span className="csv-chip error">{count('duplicate')} duplicates</span>}
            </> : <>
              <span className="csv-chip new">{tally('added')} added</span>
              <span className="csv-chip update">{tally('updated')} updated</span>
              {tally('unchanged') > 0 && <span className="item-count">{tally('unchanged')} unchanged</span>}
              {failures > 0 && <span className="csv-chip error">{failures} failed</span>}
              {imageWarnings > 0 && <span className="csv-chip warn">{imageWarnings} image warnings</span>}
            </>}
          </div>
          {ignored.length > 0 && <p className="csv-note">Ignored unknown columns: {ignored.join(', ')}</p>}

          {(phase === 'importing' || phase === 'done') && (
            <div className="csv-progress" aria-live="polite">
              <div className="progress-track"><div className="progress-fill green" style={{ width: `${progress}%` }} /></div>
              <small>{phase === 'done' ? <><Check size={13} /> Import finished</> : `Importing ${results.size} of ${importable}…`}</small>
            </div>
          )}

          <div className="csv-table" role="table" aria-label="Rows in the file">
            <div className="csv-tr csv-th" role="row"><span>Line</span><span>Barcode</span><span>Name</span><span>Status</span></div>
            {rows.map(r => {
              const result = results.get(r.row)
              const status = result?.status ?? r.status
              const tone = status === 'error' || status === 'duplicate' || status === 'failed' ? 'error' : status === 'update' || status === 'updated' ? 'update' : status === 'unchanged' ? 'muted' : 'new'
              const note = result?.message ?? result?.imageWarning ?? r.message
              return (
                <div className="csv-tr" role="row" key={r.row}>
                  <span>{r.row}</span>
                  <span className="csv-code">{r.barcode || '—'}</span>
                  <span className="csv-name">{r.cells.name || <i>{r.status === 'new' ? 'from Open Food Facts' : 'unchanged'}</i>}</span>
                  <span><b className={`csv-chip ${tone}`}>{STATUS_LABEL[status]}</b>{note && <small className={result?.imageWarning && !result.message ? 'csv-warn' : ''}>{note}</small>}</span>
                </div>
              )
            })}
          </div>

          <div className="admin-save">
            {(phase === 'done' ? failures : count('error') + count('duplicate')) > 0 && <button className="scanner-pill" onClick={downloadErrors}><Download size={14} /> Download error report</button>}
            {phase === 'ready' && <button className="primary-action" disabled={!importable} onClick={runImport}>Import {importable} product{importable === 1 ? '' : 's'}</button>}
            {phase === 'importing' && <button className="primary-action" disabled><LoaderCircle className="spin" size={18} /> Importing…</button>}
            {phase === 'done' && <a className="primary-action" href="/admin">View products</a>}
          </div>
        </div>
      )}
    </div>
  )
}
