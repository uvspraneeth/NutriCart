'use client'

import { useEffect, useEffectEvent, useRef } from 'react'
import { Check, RotateCcw, ShoppingBasket } from 'lucide-react'
import { NUTRIENTS, type CartItem, type Nutrients } from '@/lib/products'

type Props = {
  cart: CartItem[]
  consumed: Nutrients
  targets: Nutrients
  people: number
  periodLabel: string
  onNewCart: () => void
  onKeepShopping: () => void
}

const CONFETTI_COLORS = ['var(--primary)', '#7ee08f', 'var(--orange)', 'var(--yellow)', 'var(--purple)', 'var(--blue)', '#f4b6c2']

// Deterministic "random" spread so every burst looks lively but nothing jumps between renders.
const PIECES = Array.from({ length: 44 }, (_, i) => {
  const angle = (i / 44) * Math.PI * 2 + (i % 3) * 0.35
  const distance = 150 + ((i * 53) % 170)
  return {
    x: Math.round(Math.cos(angle) * distance),
    y: Math.round(Math.sin(angle) * distance * 0.75 - 90),
    rotate: (i * 67) % 720 - 360,
    delay: (i % 8) * 28,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    shape: i % 3 === 0 ? 'dot' : i % 3 === 1 ? 'strip' : 'square',
  }
})

/** A short rising arpeggio. Runs inside the tap that finished shopping, so browsers allow audio. */
function cheer() {
  navigator.vibrate?.([40, 60, 40, 60, 90])
  try {
    const audio = new AudioContext()
    ;[1046.5, 1318.5, 1568, 2093].forEach((frequency, i) => {
      const start = audio.currentTime + i * 0.09
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'triangle'
      osc.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.09, start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + (i === 3 ? 0.45 : 0.16))
      osc.connect(gain).connect(audio.destination)
      osc.start(start)
      osc.stop(start + 0.5)
    })
    window.setTimeout(() => void audio.close(), 1200)
  } catch { /* sound is a nicety */ }
}

export function FinishCelebration({ cart, consumed, targets, people, periodLabel, onNewCart, onKeepShopping }: Props) {
  const primaryRef = useRef<HTMLButtonElement>(null)
  const cheered = useRef(false) // dev StrictMode runs effects twice; cheer once
  const units = cart.reduce((sum, item) => sum + item.quantity, 0)
  const shares = NUTRIENTS.map(n => ({ ...n, share: targets[n.key] ? (consumed[n.key] / targets[n.key]) * 100 : 0 }))
  const onTrack = shares.filter(s => s.share >= 80 && s.share <= 115).length
  const title = onTrack >= 4 ? 'Beautifully balanced!' : onTrack >= 2 ? 'Great haul!' : 'Cart complete!'

  const onKey = useEffectEvent((event: KeyboardEvent) => { if (event.key === 'Escape') onKeepShopping() })
  useEffect(() => {
    if (!cheered.current) { cheered.current = true; cheer() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    primaryRef.current?.focus()
    const listener = (event: KeyboardEvent) => onKey(event)
    window.addEventListener('keydown', listener)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', listener) }
  }, [])

  return (
    <div className="celebration" role="dialog" aria-modal="true" aria-labelledby="celebration-title">
      <div className="confetti" aria-hidden="true">
        {PIECES.map((p, i) => (
          <i key={i} className={p.shape} style={{ '--x': `${p.x}px`, '--y': `${p.y}px`, '--r': `${p.rotate}deg`, '--d': `${p.delay}ms`, background: p.color } as React.CSSProperties} />
        ))}
      </div>

      <div className="celebration-card">
        <div className="celebration-badge" aria-hidden="true"><span /><Check size={46} strokeWidth={3} /></div>
        <p className="eyebrow">WOOHOO!</p>
        <h2 id="celebration-title">{title}</h2>
        <p className="celebration-lead">
          {units} item{units === 1 ? '' : 's'} for {people} {people === 1 ? 'person' : 'people'} · {periodLabel} plan
        </p>

        <div className="celebration-goals" aria-label={`How this cart covers your ${periodLabel} goals`}>
          {shares.map(({ key, label, color, share }, i) => (
            <div className="celebration-goal" key={key} style={{ '--i': i } as React.CSSProperties}>
              <span>{label}</span>
              <div className="progress-track"><div className={`progress-fill ${color}`} style={{ width: `${Math.min(100, share)}%` }} /></div>
              <b>{share > 0 && share < 1 ? '<1' : Math.round(share)}%</b>
            </div>
          ))}
        </div>
        <p className="celebration-note">
          {onTrack >= 4 ? 'Almost every goal is right where it should be. Nicely done.'
            : onTrack > 0 ? `${onTrack} of 5 ${periodLabel} goals are on track.`
              : `Every item counts toward your ${periodLabel} goals.`}
        </p>

        <div className="celebration-actions">
          <button ref={primaryRef} className="primary-action" onClick={onNewCart}><RotateCcw size={18} /> Start a new cart</button>
          <button className="scanner-pill" onClick={onKeepShopping}><ShoppingBasket size={15} /> Keep shopping</button>
        </div>
      </div>
    </div>
  )
}
