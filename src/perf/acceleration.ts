/** Ein Messpunkt: Zeit in s seit Messbeginn, Geschwindigkeit in km/h. */
export interface SpeedSample {
  t: number
  v: number
}

export interface Split {
  label: string
  /** Zeit in s, oder null wenn nicht erreicht. */
  time: number | null
  /** Endgeschwindigkeit (nur bei Streckenmessungen). */
  trapSpeed?: number
}

export const STANDING_TARGETS = [50, 100, 150, 200]
export const ROLLING_INTERVALS: [number, number][] = [
  [60, 100],
  [80, 120],
  [100, 150],
  [100, 200],
]
export const DISTANCES: { label: string; meters: number }[] = [
  { label: '100 m', meters: 100 },
  { label: '1/8 Meile', meters: 201.17 },
  { label: '1/4 Meile', meters: 402.34 },
]

/** Zeitpunkt, an dem die Kurve `value` erstmals aufsteigend überschreitet (linear interpoliert). */
export function crossing(samples: SpeedSample[], value: number, from = 0): number | null {
  for (let i = Math.max(1, from); i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    if (a.v < value && b.v >= value) {
      return a.t + ((value - a.v) / (b.v - a.v)) * (b.t - a.t)
    }
  }
  return null
}

/**
 * Schätzt den Losfahrzeitpunkt: Die ersten beiden Messpunkte über 0 werden
 * rückwärts auf v = 0 extrapoliert, begrenzt auf das Intervall zwischen
 * letztem Stillstands- und erstem Fahrt-Messpunkt.
 */
export function estimateLaunch(samples: SpeedSample[]): number {
  const i = samples.findIndex((s) => s.v > 0)
  if (i <= 0) return samples[0]?.t ?? 0
  const lastStop = samples[i - 1].t
  const first = samples[i]
  const second = samples[i + 1]
  if (!second || second.v <= first.v) return (lastStop + first.t) / 2
  const slope = (second.v - first.v) / (second.t - first.t)
  return Math.min(first.t, Math.max(lastStop, first.t - first.v / slope))
}

/** Zurückgelegte Strecke (m) bis zu jedem Messpunkt, Trapezregel. */
export function distances(samples: SpeedSample[], start: number): number[] {
  const out: number[] = []
  let d = 0
  let prev: SpeedSample = { t: start, v: 0 }
  for (const s of samples) {
    if (s.t <= start) {
      out.push(0)
      continue
    }
    d += (((prev.v + s.v) / 2) * (s.t - prev.t)) / 3.6
    out.push(d)
    prev = s
  }
  return out
}

export interface RunResult {
  id: string
  date: string
  standing: boolean
  maxSpeed: number
  splits: Split[]
  samples: SpeedSample[]
}

/** Wertet eine aufgezeichnete Fahrt aus. `standing` = Start aus dem Stand. */
export function analyzeRun(samples: SpeedSample[], standing: boolean): RunResult {
  const splits: Split[] = []
  const launch = standing ? estimateLaunch(samples) : samples[0]?.t ?? 0
  const maxSpeed = Math.max(0, ...samples.map((s) => s.v))

  if (standing) {
    for (const target of STANDING_TARGETS) {
      if (target > maxSpeed + 30) continue
      const t = crossing(samples, target)
      splits.push({ label: `0–${target} km/h`, time: t === null ? null : t - launch })
    }
    const dist = distances(samples, launch)
    for (const { label, meters } of DISTANCES) {
      const i = dist.findIndex((d) => d >= meters)
      if (i <= 0) {
        if (dist[dist.length - 1] > meters * 0.5) splits.push({ label, time: null })
        continue
      }
      const frac = (meters - dist[i - 1]) / (dist[i] - dist[i - 1])
      const t = samples[i - 1].t + frac * (samples[i].t - samples[i - 1].t)
      const trap = samples[i - 1].v + frac * (samples[i].v - samples[i - 1].v)
      splits.push({ label, time: t - launch, trapSpeed: trap })
    }
  }

  for (const [from, to] of ROLLING_INTERVALS) {
    if (samples[0] && samples[0].v > from) continue
    if (to > maxSpeed + 30) continue
    const start = crossing(samples, from)
    const end = crossing(samples, to)
    splits.push({
      label: `${from}–${to} km/h`,
      time: start !== null && end !== null ? end - start : null,
    })
  }

  return {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    standing,
    maxSpeed,
    splits,
    samples: samples.map((s) => ({ t: s.t - launch, v: s.v })),
  }
}
