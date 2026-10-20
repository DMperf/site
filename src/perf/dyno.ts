/**
 * Leistungsmessung aus Beschleunigung (Rollenprüfstand-Ersatz).
 *
 * Im festen Gang ist die Geschwindigkeit proportional zur Drehzahl (v = k · n).
 * Die Drehzahl kommt per OBD mit 0,25 U/min Auflösung – viel feiner als die
 * Geschwindigkeit (1 km/h). Deshalb wird v aus der Drehzahl berechnet und k nur
 * einmal aus den Geschwindigkeitswerten bestimmt.
 *
 *   P_Rad = m_eff · a · v + ½ · ρ · cw · A · v³ + m · g · c_rr · v
 *   P_Motor = P_Rad / (1 − Antriebsverlust)
 */

export interface DynoSettings {
  /** Fahrzeuggewicht inkl. Fahrer und Tankinhalt (kg). */
  mass: number
  cw: number
  /** Stirnfläche (m²). */
  area: number
  /** Antriebsstrangverlust in %. */
  loss: number
}

export const DEFAULT_DYNO_SETTINGS: DynoSettings = { mass: 1500, cw: 0.3, area: 2.2, loss: 15 }

const RHO = 1.2
const G = 9.81
const ROLLING_RESISTANCE = 0.012
/** Zuschlag für rotierende Massen (Räder, Antriebsstrang) im 3./4. Gang. */
const ROTATING_MASS_FACTOR = 1.05
const PS_PER_KW = 1 / 0.73549875
const WINDOW_S = 0.35
const BIN_RPM = 100

export interface RpmSample {
  t: number
  rpm: number
}

export interface SpeedPoint {
  t: number
  v: number
}

export interface DynoPoint {
  rpm: number
  ps: number
  nm: number
}

export interface DynoResult {
  id: string
  date: string
  points: DynoPoint[]
  peakPs: DynoPoint
  peakNm: DynoPoint
  /** km/h pro 1000 U/min – zeigt, welcher Gang gefahren wurde. */
  kmhPer1000: number
  settings: DynoSettings
}

/** Ansteigender Abschnitt bis zur Höchstdrehzahl (Vollgaszug). */
export function pullSegment(samples: RpmSample[]): RpmSample[] {
  if (samples.length < 3) return []
  let peak = 0
  samples.forEach((s, i) => {
    if (s.rpm > samples[peak].rpm) peak = i
  })
  let start = peak
  // Kleine Einbrüche (Messrauschen) bis 50 U/min tolerieren.
  while (start > 0 && samples[start - 1].rpm < samples[start].rpm + 50) start--
  // Ab dem tiefsten Punkt starten.
  let low = start
  for (let i = start; i < peak; i++) if (samples[i].rpm < samples[low].rpm) low = i
  // Plateau (Rollen, schleifende Kupplung) und Sprünge (Einkuppeln) vor dem Zug überspringen.
  while (low < peak - 1) {
    const step = samples[low + 1].rpm - samples[low].rpm
    if (step >= 15 && step <= 800) break
    low++
  }
  return samples.slice(low, peak + 1)
}

/** Steigung und Wert einer Regressionsgerade durch die Punkte um t. */
function localFit(samples: RpmSample[], i: number) {
  const t0 = samples[i].t
  let n = 0, st = 0, sr = 0, stt = 0, str = 0
  for (const s of samples) {
    const dt = s.t - t0
    if (Math.abs(dt) > WINDOW_S) continue
    n++
    st += dt
    sr += s.rpm
    stt += dt * dt
    str += dt * s.rpm
  }
  const denom = n * stt - st * st
  if (n < 3 || denom === 0) return null
  const slope = (n * str - st * sr) / denom
  const rpm = (sr - slope * st) / n
  return { rpm, slope }
}

export function analyzePull(
  rpmSamples: RpmSample[],
  speedSamples: SpeedPoint[],
  settings: DynoSettings,
): DynoResult | string {
  const pull = pullSegment(rpmSamples)
  if (pull.length < 10) return 'Zu wenige Messpunkte. Vollgas über mindestens 2000 U/min halten.'
  const from = pull[0]
  const to = pull[pull.length - 1]
  if (to.rpm - from.rpm < 1500) return 'Drehzahlbereich zu klein (mindestens 1500 U/min nötig).'

  // Übersetzung k (km/h pro U/min) aus Geschwindigkeitswerten im Zug bestimmen.
  const rpmAt = (t: number) => {
    const j = pull.findIndex((s) => s.t >= t)
    if (j <= 0) return null
    const a = pull[j - 1], b = pull[j]
    return a.rpm + ((t - a.t) / (b.t - a.t)) * (b.rpm - a.rpm)
  }
  let num = 0, den = 0
  for (const s of speedSamples) {
    if (s.t < from.t || s.t > to.t || s.v < 10) continue
    const rpm = rpmAt(s.t)
    if (rpm === null) continue
    num += s.v * rpm
    den += rpm * rpm
  }
  if (den === 0) return 'Keine Geschwindigkeitswerte während des Zugs erhalten.'
  const k = num / den

  const mEff = settings.mass * ROTATING_MASS_FACTOR
  const efficiency = 1 - settings.loss / 100
  const bins = new Map<number, { ps: number; nm: number; n: number }>()

  for (let i = 0; i < pull.length; i++) {
    // Nur Punkte, deren Regressionsfenster vollständig im Zug liegt.
    if (pull[i].t - WINDOW_S < from.t || pull[i].t + WINDOW_S > to.t) continue
    const fit = localFit(pull, i)
    if (!fit) continue
    const v = (k * fit.rpm) / 3.6
    const a = (k * fit.slope) / 3.6
    const wheel =
      mEff * a * v + 0.5 * RHO * settings.cw * settings.area * v ** 3 + settings.mass * G * ROLLING_RESISTANCE * v
    const kw = wheel / efficiency / 1000
    const nm = (kw * 1000 * 60) / (2 * Math.PI * fit.rpm)
    const bin = Math.round(fit.rpm / BIN_RPM) * BIN_RPM
    const entry = bins.get(bin) ?? { ps: 0, nm: 0, n: 0 }
    entry.ps += kw * PS_PER_KW
    entry.nm += nm
    entry.n++
    bins.set(bin, entry)
  }

  const points = [...bins.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rpm, e]) => ({ rpm, ps: e.ps / e.n, nm: e.nm / e.n }))
    .filter((p) => p.ps > 0)

  // Übergang ins Vollgas am Anfang (Kurve fällt zunächst) abschneiden.
  let first = 0
  while (first < points.length - 2 && points[first + 1].ps < points[first].ps) first++
  const trimmed = points.slice(first)
  if (trimmed.length < 5) return 'Auswertung fehlgeschlagen – bitte erneut messen.'
  const peakPs = trimmed.reduce((a, b) => (b.ps > a.ps ? b : a))
  const peakNm = trimmed.reduce((a, b) => (b.nm > a.nm ? b : a))

  return {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    points: trimmed,
    peakPs,
    peakNm,
    kmhPer1000: k * 1000,
    settings,
  }
}
