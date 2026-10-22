import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeRun, type SpeedSample } from '../src/perf/acceleration'
import { analyzePull, DEFAULT_DYNO_SETTINGS, type RpmSample, type SpeedPoint } from '../src/perf/dyno'

test('0–100 km/h auf ±0,15 s genau bei 5–15 Hz und 1 km/h Auflösung', () => {
  const vTrue = (t: number) => (t < 0 ? 0 : 160 * (1 - Math.exp(-t / 8)))
  const true100 = -8 * Math.log(1 - 100 / 160)
  for (const hz of [5, 10, 15]) {
    for (let trial = 0; trial < 50; trial++) {
      const launch = 2 + Math.random()
      const samples: SpeedSample[] = []
      for (let t = Math.random() / hz; t < 20; t += (1 / hz) * (0.8 + Math.random() * 0.4)) {
        samples.push({ t, v: Math.round(vTrue(t - launch)) })
      }
      const t100 = analyzeRun(samples, true).splits.find((s) => s.label === '0–100 km/h')!.time!
      assert.ok(Math.abs(t100 - true100) < 0.15, `${hz} Hz: ${t100.toFixed(3)} statt ${true100.toFixed(3)}`)
    }
  }
})

test('Leistung und Drehmoment aus einem simulierten Zug im 3. Gang', () => {
  const torque = (rpm: number) =>
    rpm < 1500 ? 200 + (rpm - 1000) * 0.24 : rpm < 4500 ? 320 : 320 - (rpm - 4500) * 0.06
  const ratio = 1.45 * 3.7
  const r = 0.32
  const m = 1500
  let v = ((1800 / ratio / 60) * 2 * Math.PI * r)
  let t = 0
  let next = 0
  let i = 0
  const rpmS: RpmSample[] = []
  const spS: SpeedPoint[] = []
  for (;;) {
    const rpm = ((v / r) * 60 * ratio) / (2 * Math.PI)
    if (rpm > 6400) break
    if (t >= next) {
      if (i++ % 4 === 0) spS.push({ t, v: Math.round(v * 3.6) })
      else rpmS.push({ t, rpm: Math.round(rpm * 4) / 4 })
      next = t + 0.06 + Math.random() * 0.03
    }
    const force = (torque(rpm) * ratio * 0.85) / r - (0.5 * 1.2 * 0.3 * 2.2 * v * v + m * 9.81 * 0.012)
    v += (force / (m * 1.05)) * 0.001
    t += 0.001
  }
  const res = analyzePull(rpmS, spS, DEFAULT_DYNO_SETTINGS)
  assert.ok(typeof res !== 'string', String(res))
  if (typeof res === 'string') return
  // Wahr: 207 PS, 320 Nm
  assert.ok(Math.abs(res.peakPs.ps - 207) < 6, `${res.peakPs.ps} PS`)
  assert.ok(Math.abs(res.peakNm.nm - 320) < 10, `${res.peakNm.nm} Nm`)
})
