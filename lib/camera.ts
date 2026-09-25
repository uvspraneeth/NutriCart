// Picks the rear lens that can focus at barcode distance. `facingMode: 'environment'` lets the browser pick
// any rear lens, and on multi-camera phones that is sometimes the ultra-wide or telephoto, which blurs close up.

type Camera = Pick<MediaDeviceInfo, 'deviceId' | 'label'>

const REAR = /back|rear|environment/i
// Single-purpose lenses that can't focus close. (iOS "Dual Wide"/"Triple" are virtual cameras that switch
// lenses automatically, so they're good choices, not auxiliaries.)
const AUXILIARY = /ultra|tele|depth|macro|infrared|\bir\b/i

function rank(label: string) {
  // Android Chrome labels lenses "camera2 N, facing back"; the main rear sensor has the lowest id.
  const androidId = label.match(/camera2?\s*(\d+)/i)?.[1]
  if (androidId !== undefined) return Number(androidId)
  // iOS: prefer the virtual multi-lens cameras (they pick the macro lens when you get close).
  if (/triple/i.test(label)) return 0
  if (/dual wide/i.test(label)) return 1
  if (/dual/i.test(label)) return 2
  return 3
}

/** Best rear camera for scanning, or null when labels are unavailable or there is no rear camera (laptops). */
export function pickRearCamera(cameras: Camera[]): string | null {
  const rear = cameras.filter(c => REAR.test(c.label))
  if (!rear.length) return null
  const main = rear.filter(c => !AUXILIARY.test(c.label))
  const pool = main.length ? main : rear
  // Stable sort keeps the browser's order among equally ranked lenses.
  return [...pool].sort((a, b) => rank(a.label) - rank(b.label))[0].deviceId
}
