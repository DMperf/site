import { useEffect, useRef, useState } from 'react'
import type { Elm327 } from '../obd/elm327'
import { PID_BY_ID } from '../obd/pids'
import {
  analyzePull,
  DEFAULT_DYNO_SETTINGS,
  type DynoResult,
  type DynoSettings,
  type RpmSample,
  type SpeedPoint,
} from '../perf/dyno'
import { load, save } from '../storage'
import { LineChart } from './LineChart'

const RPM = PID_BY_ID.get(0x0c)!
const SPEED = PID_BY_ID.get(0x0d)!
const SETTINGS_KEY = 'obd.dyno.settings'
const HISTORY_KEY = 'obd.dyno.history'
const MAX_PULL_S = 30
/** Geschwindigkeit nur bei jeder n-ten Abfrage lesen – die Drehzahl ist wichtiger. */
const SPEED_EVERY = 4

const FIELDS: { key: keyof DynoSettings; label: string; unit: string; step: number }[] = [
  { key: 'mass', label: 'Gewicht inkl. Fahrer', unit: 'kg', step: 10 },
  { key: 'cw', label: 'cw-Wert', unit: '', step: 0.01 },
  { key: 'area', label: 'Stirnfläche', unit: 'm²', step: 0.05 },
  { key: 'loss', label: 'Antriebsverlust', unit: '%', step: 1 },
]

export function DynoPanel({ elm }: { elm: Elm327 }) {
  const [settings, setSettings] = useState<DynoSettings>(() => load(SETTINGS_KEY, DEFAULT_DYNO_SETTINGS))
  const [recording, setRecording] = useState(false)
  const [rpm, setRpm] = useState<number | null>(null)
  const [rate, setRate] = useState(0)
  const [result, setResult] = useState<DynoResult | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [history, setHistory] = useState<DynoResult[]>(() => load(HISTORY_KEY, []))
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    if (!recording) return
    let cancelled = false
    const rpmSamples: RpmSample[] = []
    const speedSamples: SpeedPoint[] = []

    const finish = () => {
      setRecording(false)
      const res = analyzePull(rpmSamples, speedSamples, settingsRef.current)
      if (typeof res === 'string') {
        setMessage(res)
        return
      }
      setResult(res)
      setHistory((prev) => {
        const next = [res, ...prev].slice(0, 20)
        save(HISTORY_KEY, next)
        return next
      })
    }

    const loop = async () => {
      let i = 0
      let max = 0
      let min = Infinity
      // Tiefster Wert vor dem aktuellen Maximum – Anstieg = max − riseLow.
      let riseLow = Infinity
      const started = performance.now()
      while (!cancelled) {
        const reading =
          i++ % SPEED_EVERY === 0
            ? await elm.readPidTimed(SPEED).catch(() => null)
            : await elm.readPidTimed(RPM).catch(() => null)
        if (cancelled) return
        if (!reading || reading.value === null) continue
        const t = reading.t / 1000
        if ((i - 1) % SPEED_EVERY === 0) {
          speedSamples.push({ t, v: reading.value })
          continue
        }
        rpmSamples.push({ t, rpm: reading.value })
        setRpm(reading.value)
        setRate(rpmSamples.length / ((performance.now() - started) / 1000))
        min = Math.min(min, reading.value)
        if (reading.value > max) {
          max = reading.value
          riseLow = min
        }
        // Automatisches Ende: Drehzahl fällt nach einem echten Zug deutlich (Gas weg / Schalten).
        const pulled = max - riseLow > 1500
        if ((pulled && reading.value < max - 400) || t - rpmSamples[0].t > MAX_PULL_S) {
          finish()
          return
        }
      }
    }
    void loop()
    return () => {
      cancelled = true
    }
  }, [elm, recording])

  const update = (key: keyof DynoSettings, value: number) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    save(SETTINGS_KEY, next)
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="font-medium">So wird gemessen</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-400">
              <li>Fahrzeugdaten rechts eintragen (Gewicht ist am wichtigsten).</li>
              <li>Ebene, gerade Strecke. Im 3. Gang (Automatik: manueller Modus) auf ca. 1500–2000 U/min rollen.</li>
              <li>„Messung starten“ tippen, dann Vollgas bis kurz vor den Begrenzer.</li>
              <li>Gas weg – die Messung endet automatisch und wird ausgewertet.</li>
            </ol>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="text-sm">
                <span className="text-zinc-400">{f.label}</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    step={f.step}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1"
                    value={settings[f.key]}
                    disabled={recording}
                    onChange={(e) => update(f.key, Number(e.target.value))}
                  />
                  <span className="w-6 text-zinc-500">{f.unit}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          {recording ? (
            <button className="btn-small border-red-600 text-red-400" onClick={() => setRecording(false)}>
              Abbrechen
            </button>
          ) : (
            <button
              className="rounded-xl bg-red-600 px-6 py-3 font-medium text-white hover:bg-red-500"
              onClick={() => {
                setMessage(null)
                setRecording(true)
              }}
            >
              Messung starten
            </button>
          )}
          {recording && (
            <span className="text-2xl font-semibold tabular-nums">
              {rpm === null ? '–' : rpm.toFixed(0)} <span className="text-sm text-zinc-500">U/min</span>
              <span className="ml-3 text-xs font-normal text-zinc-500">{rate.toFixed(1)} Werte/s</span>
            </span>
          )}
        </div>
        {message && <p className="mt-3 text-sm text-amber-400">{message}</p>}
      </section>

      {result && <DynoCard result={result} />}

      {history.length > 0 && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="font-medium">Verlauf</h3>
          <ul className="mt-2 divide-y divide-zinc-800 text-sm">
            {history.map((h) => (
              <li key={h.id}>
                <button className="flex w-full justify-between py-2 text-left hover:text-white" onClick={() => setResult(h)}>
                  <span className="text-zinc-400">
                    {new Date(h.date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                  <span className="tabular-nums">
                    {h.peakPs.ps.toFixed(0)} PS · {h.peakNm.nm.toFixed(0)} Nm
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-zinc-500">
        Die Leistung wird aus der Beschleunigung berechnet (Fahrwiderstände + Massenträgheit) und auf
        die Kurbelwelle hochgerechnet. Wind, Steigung und ungenaue Fahrzeugdaten verfälschen das Ergebnis –
        für Vorher/Nachher-Vergleiche immer gleiche Strecke, Richtung und Gang verwenden. Kein Ersatz für
        einen Rollenprüfstand. Nur auf abgesperrten Strecken messen.
      </p>
    </div>
  )
}

function DynoCard({ result }: { result: DynoResult }) {
  const kw = result.peakPs.ps * 0.73549875
  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-zinc-950 p-4">
          <div className="text-xs text-zinc-500">Max. Leistung</div>
          <div className="text-3xl font-bold tabular-nums">
            {result.peakPs.ps.toFixed(0)} <span className="text-base font-normal text-zinc-500">PS</span>
          </div>
          <div className="text-xs text-zinc-500">
            {kw.toFixed(0)} kW bei {result.peakPs.rpm} U/min
          </div>
        </div>
        <div className="rounded-xl bg-zinc-950 p-4">
          <div className="text-xs text-zinc-500">Max. Drehmoment</div>
          <div className="text-3xl font-bold tabular-nums">
            {result.peakNm.nm.toFixed(0)} <span className="text-base font-normal text-zinc-500">Nm</span>
          </div>
          <div className="text-xs text-zinc-500">bei {result.peakNm.rpm} U/min</div>
        </div>
        <div className="rounded-xl bg-zinc-950 p-4">
          <div className="text-xs text-zinc-500">Übersetzung</div>
          <div className="text-3xl font-bold tabular-nums">
            {result.kmhPer1000.toFixed(1)} <span className="text-base font-normal text-zinc-500">km/h</span>
          </div>
          <div className="text-xs text-zinc-500">pro 1000 U/min · {result.settings.mass} kg</div>
        </div>
      </div>
      <div>
        <h4 className="text-sm text-zinc-400">Leistung (PS)</h4>
        <LineChart
          points={result.points.map((p) => ({ x: p.rpm, y: p.ps }))}
          xLabel="U/min"
          yLabel="PS"
          height={220}
          highlight={{ x: result.peakPs.rpm, y: result.peakPs.ps, label: `${result.peakPs.ps.toFixed(0)} PS` }}
        />
      </div>
      <div>
        <h4 className="text-sm text-zinc-400">Drehmoment (Nm)</h4>
        <LineChart
          points={result.points.map((p) => ({ x: p.rpm, y: p.nm }))}
          xLabel="U/min"
          yLabel="Nm"
          height={220}
          highlight={{ x: result.peakNm.rpm, y: result.peakNm.nm, label: `${result.peakNm.nm.toFixed(0)} Nm` }}
        />
      </div>
    </section>
  )
}
