'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Check, Flashlight, FlashlightOff, Keyboard, LoaderCircle, PackageSearch, ScanLine, SwitchCamera, TriangleAlert, Undo2, X } from 'lucide-react'
import { expandUpcE, isValidGtin } from '@/lib/barcode'
import { pickRearCamera } from '@/lib/camera'
import { lookupProduct, NUTRIENTS, productKey, type CartItem, type Nutrients, type Product } from '@/lib/products'

// Grocery symbologies only: each carries a check digit, so misreads can be rejected outright.
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']
const SCAN_INTERVAL_MS = 110
// While the same code stays in view it is ignored; pull it away for this long to scan another unit.
const SAME_CODE_COOLDOWN_MS = 1500
const RESUME_AFTER_ADD_MS = 1600
// The shopper's manual "switch camera" choice, remembered per browser.
const CAMERA_KEY = 'nc-camera'

function storedCamera() {
  try { return localStorage.getItem(CAMERA_KEY) } catch { return null }
}
function rememberCamera(id: string | null) {
  try { if (id) localStorage.setItem(CAMERA_KEY, id); else localStorage.removeItem(CAMERA_KEY) } catch { /* private mode */ }
}

type DetectedCode = { rawValue: string; format: string }
type Detector = { detect: (source: CanvasImageSource) => Promise<DetectedCode[]> }
type NativeDetectorClass = { new (options: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> }

let detectorPromise: Promise<Detector> | null = null

// Native BarcodeDetector (Chrome/Android) is fastest; everywhere else (iOS Safari, Firefox, desktop)
// fall back to the ZXing WebAssembly build, served from /vendor so it works without a CDN.
function getDetector() {
  detectorPromise ??= (async () => {
    const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector
    if (Native) {
      try {
        const supported = await Native.getSupportedFormats()
        if (FORMATS.every(format => supported.includes(format))) return new Native({ formats: FORMATS })
      } catch { /* fall through to WebAssembly */ }
    }
    const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill')
    await prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? `/vendor/${path}` : prefix + path }, fireImmediately: true })
    return new BarcodeDetector({ formats: FORMATS as never }) as unknown as Detector
  })()
  detectorPromise.catch(() => { detectorPromise = null })
  return detectorPromise
}

let audio: AudioContext | null = null

/** Call from the click that opens the scanner: browsers only allow audio after a user gesture. */
export function primeScannerFeedback() {
  try {
    audio ??= new AudioContext()
    void audio.resume()
  } catch { /* audio is a nicety */ }
}

function feedback(kind: 'success' | 'miss') {
  navigator.vibrate?.(kind === 'success' ? 70 : [40, 60, 40])
  if (!audio || audio.state !== 'running') return
  const tones = kind === 'success' ? [1760] : [440, 330]
  tones.forEach((frequency, i) => {
    const start = audio!.currentTime + i * 0.13
    const osc = audio!.createOscillator()
    const gain = audio!.createGain()
    osc.type = kind === 'success' ? 'square' : 'sine'
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11)
    osc.connect(gain).connect(audio!.destination)
    osc.start(start)
    osc.stop(start + 0.12)
  })
}

/** Crops the frame to the on-screen viewfinder (plus margin): faster decoding and it matches what the user aims at. */
function captureViewfinder(video: HTMLVideoElement, container: HTMLElement, finder: HTMLElement, canvas: HTMLCanvasElement) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const box = container.getBoundingClientRect()
  const target = finder.getBoundingClientRect()
  if (!vw || !vh || !box.width) return video
  const scale = Math.max(box.width / vw, box.height / vh) // object-fit: cover
  const offsetX = (vw * scale - box.width) / 2
  const offsetY = (vh * scale - box.height) / 2
  const margin = 0.2
  let sx = (target.left - box.left + offsetX) / scale - (target.width / scale) * margin
  let sy = (target.top - box.top + offsetY) / scale - (target.height / scale) * margin
  let sw = (target.width / scale) * (1 + margin * 2)
  let sh = (target.height / scale) * (1 + margin * 2)
  sx = Math.max(0, sx); sy = Math.max(0, sy)
  sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh)
  const ratio = Math.min(1, 1280 / sw)
  canvas.width = Math.round(sw * ratio)
  canvas.height = Math.round(sh * ratio)
  canvas.getContext('2d', { willReadFrequently: true })?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return canvas
}

function pickValidCode(codes: DetectedCode[]) {
  for (const { rawValue, format } of codes) {
    const value = rawValue.trim()
    const code = format === 'upc_e' ? expandUpcE(value) : value
    if (code && isValidGtin(code)) return code
  }
  return null
}

type Camera = 'starting' | 'live' | 'denied' | 'unavailable' | 'insecure'
type Phase = 'scanning' | 'looking-up' | 'added' | 'review'
type Result =
  | { kind: 'added'; product: Product; undone?: boolean }
  | { kind: 'not-found'; code: string }
  | { kind: 'failed'; code: string; message: string }

type Props =
  | { mode?: 'cart'; cart: CartItem[]; targets: Nutrients; periodLabel: string; onAdd: (product: Product) => void; onUndo: (product: Product) => void; onClose: () => void }
  /** Staff registration: hand back the first valid barcode instead of looking it up and filling a cart. */
  | { mode: 'pick'; onPick: (code: string) => void; onClose: () => void }

export function BarcodeScanner(props: Props) {
  const { onClose } = props
  const picking = props.mode === 'pick'
  const [camera, setCamera] = useState<Camera>('starting')
  const [phase, setPhase] = useState<Phase>('scanning')
  const [result, setResult] = useState<Result | null>(null)
  const [pendingCode, setPendingCode] = useState('')
  const [decoderFailed, setDecoderFailed] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | null>(storedCamera)
  const [restartKey, setRestartKey] = useState(0)
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false })
  const [manualOpen, setManualOpen] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [sessionCount, setSessionCount] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const finderRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const manualRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lastCodeRef = useRef<{ code: string; seenAt: number } | null>(null)
  const resumeTimer = useRef<number | undefined>(undefined)
  const lookupAbort = useRef<AbortController | null>(null)
  const autoPicked = useRef(false)

  function stopStream() {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  // Camera lifecycle: (re)starts on mount, camera switch, and when the tab becomes visible again.
  useEffect(() => {
    let cancelled = false
    async function start() {
      setCamera('starting')
      if (!window.isSecureContext) { setCamera('insecure'); setManualOpen(true); return }
      if (!navigator.mediaDevices?.getUserMedia) { setCamera('unavailable'); setManualOpen(true); return }
      try {
        const source: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...source, width: { ideal: 1920 }, height: { ideal: 1080 } } })
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return }
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] }
        setTorch({ supported: Boolean(caps.torch), on: false })
        if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {})
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        if (cancelled) return
        setCamera('live')
        // Labels are only readable once permission is granted, so pick the lens now. Once per session,
        // and never over a camera the shopper chose themselves.
        const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput')
        if (cancelled) return
        setDevices(cameras)
        if (!deviceId && !autoPicked.current) {
          autoPicked.current = true
          const best = pickRearCamera(cameras)
          if (best && best !== track.getSettings().deviceId) setDeviceId(best)
        }
      } catch (error) {
        if (cancelled) return
        const name = (error as DOMException).name
        // A remembered camera that no longer exists (other phone, unplugged webcam): forget it and use the default.
        if (deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError')) { rememberCamera(null); setDeviceId(null); return }
        setCamera(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable')
        setManualOpen(true)
      }
    }
    start()
    return () => { cancelled = true; stopStream() }
  }, [deviceId, restartKey])

  useEffect(() => {
    function onVisibility() {
      if (document.hidden) { stopStream(); setCamera('starting') } else setRestartKey(k => k + 1)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Warm the decoder while the camera spins up.
  useEffect(() => { getDetector().catch(() => setDecoderFailed(true)) }, [])

  // Modal behaviour: lock page scroll, Escape closes, focus lands inside, cleanup on unmount.
  const onKey = useEffectEvent((event: KeyboardEvent) => { if (event.key === 'Escape') onClose() })
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const listener = (event: KeyboardEvent) => onKey(event)
    window.addEventListener('keydown', listener)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', listener)
      window.clearTimeout(resumeTimer.current)
      lookupAbort.current?.abort()
    }
  }, [])

  useEffect(() => { if (manualOpen) manualRef.current?.focus() }, [manualOpen])

  function resumeScanning() {
    window.clearTimeout(resumeTimer.current)
    // Anything still in view right now is the item we just handled: keep ignoring it until it leaves.
    if (lastCodeRef.current) lastCodeRef.current.seenAt = performance.now()
    setPhase('scanning')
  }

  async function submit(code: string, via: 'camera' | 'manual') {
    window.clearTimeout(resumeTimer.current)
    lookupAbort.current?.abort()
    const controller = new AbortController()
    lookupAbort.current = controller
    setPendingCode(code)
    setPhase('looking-up')
    if (via === 'camera') feedback('success')
    if (props.mode === 'pick') { props.onPick(code); return }
    const { onAdd } = props
    try {
      const lookup = await lookupProduct(code, controller.signal)
      if (lookup.status === 'found') {
        onAdd(lookup.product)
        setSessionCount(n => n + 1)
        setResult({ kind: 'added', product: lookup.product })
        setPhase('added')
        resumeTimer.current = window.setTimeout(resumeScanning, RESUME_AFTER_ADD_MS)
      } else {
        feedback('miss')
        setResult(lookup.status === 'not-found' ? { kind: 'not-found', code } : { kind: 'failed', code, message: lookup.message })
        setPhase('review')
      }
    } catch { /* aborted by a newer scan or by closing */ }
  }

  const onDetected = useEffectEvent((code: string) => {
    const now = performance.now()
    const last = lastCodeRef.current
    if (last && last.code === code && now - last.seenAt < SAME_CODE_COOLDOWN_MS) { last.seenAt = now; return }
    lastCodeRef.current = { code, seenAt: now }
    void submit(code, 'camera')
  })

  // Decode loop: runs only while the camera is live and we're ready for the next item.
  useEffect(() => {
    if (camera !== 'live' || phase !== 'scanning' || decoderFailed) return
    const canvas = document.createElement('canvas')
    let frame = 0
    let lastRun = 0
    let attempt = 0
    let busy = false
    let stopped = false
    async function tick(now: number) {
      frame = requestAnimationFrame(tick)
      const video = videoRef.current
      if (busy || now - lastRun < SCAN_INTERVAL_MS || !video || video.readyState < 2 || !frameRef.current || !finderRef.current) return
      lastRun = now
      busy = true
      try {
        const detector = await getDetector()
        // Mostly decode the viewfinder crop; every third pass try the whole frame in case the pack is held
        // too close and the barcode overflows the guide.
        attempt += 1
        const source = attempt % 3 === 0 ? video : captureViewfinder(video, frameRef.current, finderRef.current, canvas)
        const codes = await detector.detect(source)
        const code = !stopped && pickValidCode(codes)
        if (code) onDetected(code)
      } catch (error) {
        if ((error as Error)?.name === 'NotSupportedError' || !detectorPromise) setDecoderFailed(true)
      } finally {
        busy = false
      }
    }
    frame = requestAnimationFrame(tick)
    return () => { stopped = true; cancelAnimationFrame(frame) }
  }, [camera, phase, decoderFailed])

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const on = !torch.on
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      setTorch({ supported: true, on })
    } catch { setTorch({ supported: false, on: false }) }
  }

  function switchCamera() {
    if (devices.length < 2) return
    const current = streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId
    const index = devices.findIndex(d => d.deviceId === current)
    const next = devices[(index + 1) % devices.length].deviceId
    rememberCamera(next)
    setDeviceId(next)
  }

  function submitManual(event: React.FormEvent) {
    event.preventDefault()
    const code = manualCode.replace(/\s+/g, '')
    if (!code) { manualRef.current?.focus(); return }
    setManualCode('')
    void submit(code, 'manual')
  }

  function undo() {
    if (result?.kind !== 'added' || result.undone) return
    window.clearTimeout(resumeTimer.current)
    if (props.mode !== 'pick') props.onUndo(result.product)
    setSessionCount(n => Math.max(0, n - 1))
    setResult({ ...result, undone: true })
    resumeScanning()
  }

  const inCart = (product: Product) => props.mode === 'pick' ? 0 : props.cart.find(item => productKey(item) === productKey(product))?.quantity ?? 0
  const cameraBlocked = camera === 'denied' || camera === 'unavailable' || camera === 'insecure'
  const hint = decoderFailed ? 'Live scanning isn’t supported on this browser. Type the barcode below.'
    : phase === 'looking-up' ? `${picking ? 'Opening' : 'Looking up'} ${pendingCode}…`
      : phase === 'added' ? 'Added. Scan the next item.'
        : phase === 'review' ? 'Scanning paused'
          : camera === 'live' ? 'Point at a barcode. It scans automatically.'
            : 'Starting camera…'

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
      <div className="scanner-sheet">
        <div className={`scanner-stage phase-${phase} camera-${camera}`} ref={frameRef}>
          <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" />

          <div className="scanner-topbar">
            <button ref={closeRef} className="scanner-icon" onClick={onClose} aria-label="Close scanner"><X size={20} /></button>
            <div className="scanner-title">
              <h2 id="scanner-title">{picking ? 'Scan product' : 'Scan items'}</h2>
              {sessionCount > 0 && <span>{sessionCount} added</span>}
            </div>
            <div className="scanner-tools">
              {torch.supported && <button className={`scanner-icon ${torch.on ? 'on' : ''}`} onClick={toggleTorch} aria-pressed={torch.on} aria-label={torch.on ? 'Turn flashlight off' : 'Turn flashlight on'}>{torch.on ? <FlashlightOff size={19} /> : <Flashlight size={19} />}</button>}
              {devices.length > 1 && <button className="scanner-icon" onClick={switchCamera} aria-label="Switch camera"><SwitchCamera size={19} /></button>}
            </div>
          </div>

          {cameraBlocked ? (
            <div className="camera-message">
              <TriangleAlert size={28} />
              <b>{camera === 'denied' ? 'Camera access is off' : camera === 'insecure' ? 'Camera needs a secure connection' : 'No camera available'}</b>
              <p>{camera === 'denied' ? 'Allow camera access for this site in your browser settings, then try again. Or type the barcode below.'
                : camera === 'insecure' ? 'Open NutriCart over HTTPS (or localhost) to scan with your camera. Typing the barcode works everywhere.'
                  : 'We couldn’t find a camera on this device. Type the barcode printed under the lines instead.'}</p>
              {camera === 'denied' && <button className="scanner-pill" onClick={() => setRestartKey(k => k + 1)}>Try again</button>}
            </div>
          ) : (
            <div className="viewfinder" ref={finderRef} aria-hidden="true">
              <i /><i /><i /><i />
              <div className="laser" />
              {phase === 'looking-up' && <LoaderCircle className="finder-spinner" size={34} />}
              {phase === 'added' && <Check className="finder-check" size={40} strokeWidth={3} />}
            </div>
          )}

          <p className="scanner-hint" aria-live="polite">{phase === 'scanning' && camera === 'live' && !decoderFailed && <ScanLine size={15} />}{hint}</p>
        </div>

        <div className="scanner-panel">
          {result?.kind === 'added' && props.mode !== 'pick' && <AddedCard product={result.product} undone={result.undone} quantity={inCart(result.product)} targets={props.targets} periodLabel={props.periodLabel} onUndo={undo} />}

          {(result?.kind === 'not-found' || result?.kind === 'failed') && (
            <div className="scan-result miss" role="alert">
              <div className="result-icon"><PackageSearch size={22} /></div>
              <div className="result-body">
                <b>{result.kind === 'not-found' ? 'We don’t know this product yet' : 'Lookup failed'}</b>
                <small>{result.kind === 'not-found' ? `Barcode ${result.code} isn’t in our catalogue or Open Food Facts.` : result.message}</small>
              </div>
              <div className="result-actions">
                {result.kind === 'failed' && <button className="scanner-pill" onClick={() => submit(result.code, 'manual')}>Retry</button>}
                {phase === 'review' && !cameraBlocked && <button className="scanner-pill solid" onClick={() => { setResult(null); resumeScanning() }}>Scan again</button>}
              </div>
            </div>
          )}

          {manualOpen ? (
            <form className="manual-entry" onSubmit={submitManual}>
              <label htmlFor="manual-barcode">Barcode number</label>
              <div className="manual-row">
                <input ref={manualRef} id="manual-barcode" inputMode="numeric" autoComplete="off" enterKeyHint="search" placeholder="Digits under the barcode" value={manualCode} onChange={e => setManualCode(e.target.value)} />
                <button className="primary-action" disabled={phase === 'looking-up'}>{phase === 'looking-up' ? <LoaderCircle className="spin" size={18} /> : picking ? 'Open' : 'Add'}</button>
              </div>
            </form>
          ) : (
            <button className="manual-toggle" onClick={() => setManualOpen(true)}><Keyboard size={16} /> Barcode won’t scan? Type it in</button>
          )}

          <button className="scanner-done" onClick={onClose}>{picking ? 'Cancel' : 'Done'}{sessionCount > 0 ? `: view cart (${sessionCount})` : ''}</button>
        </div>
      </div>
    </div>
  )
}

function AddedCard({ product, undone, quantity, targets, periodLabel, onUndo }: { product: Product; undone?: boolean; quantity: number; targets: Nutrients; periodLabel: string; onUndo: () => void }) {
  const basis = product.basis === 'package' ? `Whole pack · ${product.serving_size}` : product.basis === 'serving' ? `Per serving · ${product.serving_size}` : product.basis === '100g' ? 'Per 100 g' : product.serving_size
  return (
    <div className={`scan-result added ${undone ? 'undone' : ''}`} key={`${productKey(product)}-${quantity}-${undone}`}>
      <div className="result-head">
        <div className="result-thumb" style={{ background: product.accent }}>
          {product.image_url ? <img src={product.image_url} alt="" /> : <PackageSearch size={22} />}
        </div>
        <div className="result-body">
          <b>{product.name}</b>
          <small>{[product.brand, basis].filter(Boolean).join(' · ')}</small>
          <span className={`result-status ${undone ? 'muted' : ''}`}>{undone ? 'Removed from cart' : <><Check size={13} /> Added · {quantity} in cart</>}</span>
        </div>
        {product.nutriscore && <span className={`nutriscore grade-${product.nutriscore}`} title="Nutri-Score">{product.nutriscore.toUpperCase()}</span>}
        {!undone && <button className="scanner-pill" onClick={onUndo}><Undo2 size={14} /> Undo</button>}
      </div>
      {product.nutritionMissing ? (
        <p className="result-note"><TriangleAlert size={14} /> No nutrition facts are published for this product, so it won’t move your goals.</p>
      ) : (
        <div className="impact-grid" aria-label={`Share of your ${periodLabel} goals`}>
          {NUTRIENTS.map(({ key, label, unit, color }) => {
            const share = targets[key] ? (product[key] / targets[key]) * 100 : 0
            return (
              <div className="impact" key={key}>
                <small>{label}</small>
                <b>{Math.round(product[key])}<em>{unit}</em></b>
                <div className="progress-track"><div className={`progress-fill ${color}`} style={{ width: `${Math.min(100, share)}%` }} /></div>
                <small className="impact-share">{share === 0 ? '—' : `${share < 1 ? '<1' : `+${Math.round(share)}`}% goal`}</small>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
