import { useEffect, useRef, useState } from 'react'
import type { Elm327 } from '../obd/elm327'
import { PID_BY_ID } from '../obd/pids'
import { analyzeRun, type RunResult, type SpeedSample } from '../perf/acceleration'
import { load, save } from '../storage'
import { LineChart } from './LineChart'

type Mode = 'waiting' | 'armed' | 'running'

const SPEED = PID_BY_ID.get(0x0d)!
const HISTORY_KEY = 'obd.accel.history'
const CORRECTION_KEY = 'obd.accel.correction'
const MAX_RUN_S = 60
const MAX_HISTORY = 20

export function AccelPanel({ elm }: { elm: Elm327 }) {
  const [speed, setSpeed] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode>('waiting')
  const [elapsed, setElapsed] = useState(0)
  const [rate, setRate] = useState(0)
  const [result, setResult] = useState<RunResult | null>(null)
  const [history, setHistory] = useState<RunResult[]>(() => load(HISTORY_KEY, []))
  const [correction, setCorrection] = useState(() => load(CORRECTION_KEY, 0))

  // Laufzeitzustand der Messung – in Refs, damit die Abfrageschleife nicht neu startet.
  const run = useRef({
    mode: 'waiting' as Mode,
    standing: true,
    samples: [] as SpeedSample[],
    lastStop: null as SpeedSample | null,
    max: 0,
    rollingRequested: false,
    stopRequested: false,
  })
  const correctionRef = useRef(correction)
  correctionRef.current = correction

  useEffect(() => {
    let cancelled = false
    const r = run.current

    const finish = () => {
      const samples = r.samples
      r.mode = 'waiting'
      r.samples = []
      setMode('waiting')
      if (samples.length < 4 || r.max < 20) return
      const res = analyzeRun(samples, r.standing)
      setResult(res)
      setHistory((prev) => {
        const next = [res, ...prev].slice(0, MAX_HISTORY)
        save(HISTORY_KEY, next)
        return next
      })
    }

    const loop = async () => {
      let count = 0
      let windowStart = performance.now()
      while (!cancelled) {
        const reading = await elm.readPidTimed(SPEED).catch(() => null)
        if (cancelled) return
        if (!reading || reading.value === null) continue
        const sample = { t: reading.t / 1000, v: reading.value * (1 + correctionRef.current / 100) }
        setSpeed(sample.v)

        count++
        if (performance.now() - windowStart > 1000) {
          setRate((count * 1000) / (performance.now() - windowStart))
          count = 0
          windowStart = performance.now()
        }

        if (r.mode === 'running') {
          r.samples.push(sample)
          r.max = Math.max(r.max, sample.v)
          const duration = sample.t - r.samples[0].t
          setElapsed(duration)
          // Ende: Gas weg/Bremsen, Stillstand, Zeitlimit oder Abbruch.
          if (sample.v < r.max - 5 || sample.v === 0 || duration > MAX_RUN_S || r.stopRequested) {
            r.stopRequested = false
            finish()
          }
          continue
        }

        if (r.rollingRequested && sample.v > 0) {
          r.rollingRequested = false
          Object.assign(r, { mode: 'running', standing: false, samples: [sample], max: sample.v })
          setMode('running')
          continue
        }

        if (sample.v === 0) {
          r.lastStop = sample
          if (r.mode !== 'armed') {
            r.mode = 'armed'
            setMode('armed')
          }
        } else if (r.mode === 'armed' && r.lastStop) {
          Object.assign(r, { mode: 'running', standing: true, samples: [r.lastStop, sample], max: sample.v })
          setResult(null)
          setMode('running')
        }
      }
    }
    void loop()
    return () => {
      cancelled = true
    }
  }, [elm])

  const best = (label: string) => {
    const times = history
      .flatMap((h) => h.splits)
      .filter((s) => s.label === label && s.time !== null)
      .map((s) => s.time!)
    return times.length ? Math.min(...times) : null
  }

  const status: Record<Mode, string> = {
    waiting: 'Anhalten, um eine Messung aus dem Stand vorzubereiten',
    armed: 'Bereit – Messung startet automatisch beim Losfahren',
    running: 'Messung läuft … Gas wegnehmen beendet die Messung',
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-center">
        <div className="text-7xl font-bold tabular-nums">
          {speed === null ? '–' : speed.toFixed(0)}
          <span className="ml-2 text-2xl font-normal text-zinc-500">km/h</span>
        </div>
        {mode === 'running' && (
          <div className="mt-2 text-3xl font-semibold tabular-nums text-red-500">{elapsed.toFixed(2)} s</div>
        )}
        <div
          className={`mt-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm ${
            mode === 'armed'
              ? 'bg-emerald-950 text-emerald-300'
              : mode === 'running'
                ? 'bg-red-950 text-red-300'
                : 'bg-zinc-800 text-zinc-300'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              mode === 'armed' ? 'bg-emerald-400' : mode === 'running' ? 'animate-pulse bg-red-500' : 'bg-zinc-500'
            }`}
          />
          {status[mode]}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          {mode === 'running' ? (
            <button className="btn-small" onClick={() => (run.current.stopRequested = true)}>
              Messung beenden
            </button>
          ) : (
            <button
              className="btn-small"
              disabled={!speed}
              onClick={() => (run.current.rollingRequested = true)}
            >
              Durchzug ab jetzt messen
            </button>
          )}
        </div>
        <p className="mt-3 text-xs text-zinc-500">{rate.toFixed(1)} Messungen/s</p>
      </section>

      {result && <RunCard result={result} />}

      {history.length > 0 && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Bestzeiten</h3>
            <button
              className="text-xs text-zinc-500 hover:text-zinc-300"
              onClick={() => {
                if (!window.confirm('Alle gespeicherten Messungen löschen?')) return
                setHistory([])
                save(HISTORY_KEY, [])
              }}
            >
              Verlauf löschen
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {['0–100 km/h', '0–200 km/h', '100–200 km/h', '1/4 Meile'].map((label) => {
              const t = best(label)
              return (
                <div key={label} className="rounded-xl bg-zinc-950 p-3">
                  <div className="text-xs text-zinc-500">{label}</div>
                  <div className="text-xl font-semibold tabular-nums">{t === null ? '–' : `${t.toFixed(2)} s`}</div>
                </div>
              )
            })}
          </div>
          <ul className="mt-4 divide-y divide-zinc-800 text-sm">
            {history.map((h) => {
              const main = h.splits.find((s) => s.time !== null)
              return (
                <li key={h.id}>
                  <button className="flex w-full justify-between py-2 text-left hover:text-white" onClick={() => setResult(h)}>
                    <span className="text-zinc-400">
                      {new Date(h.date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                      {h.standing ? '' : ' · rollend'}
                    </span>
                    <span className="tabular-nums">
                      {main ? `${main.label}: ${main.time!.toFixed(2)} s` : '–'} · max. {h.maxSpeed.toFixed(0)} km/h
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-400">
        <label className="flex flex-wrap items-center gap-3">
          <span className="text-zinc-200">Tacho-Korrektur</span>
          <input
            type="number"
            step="0.5"
            min="-10"
            max="10"
            className="w-20 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1"
            value={correction}
            onChange={(e) => {
              const v = Number(e.target.value)
              setCorrection(v)
              save(CORRECTION_KEY, v)
            }}
          />
          <span>% (z. B. −3, wenn das OBD-Signal 3 % über GPS liegt)</span>
        </label>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>
            Genauigkeit hängt von der Abfragerate ab (oben angezeigt). Zwischen den Messpunkten wird
            linear interpoliert; die Abweichung liegt typischerweise bei ±0,1 s. Manche Steuergeräte glätten das Geschwindigkeitssignal – dann misst die App etwas langsamer als ein GPS-Messgerät.
          </li>
          <li>Nur auf abgesperrten Strecken messen. Im öffentlichen Straßenverkehr ist das verboten.</li>
        </ul>
      </section>
    </div>
  )
}

function RunCard({ result }: { result: RunResult }) {
  const splits = result.splits.filter((s) => s.time !== null)
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="font-medium">
        Ergebnis {result.standing ? 'aus dem Stand' : '(rollend)'}
        <span className="ml-2 text-sm font-normal text-zinc-500">
          {new Date(result.date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' })}
        </span>
      </h3>
      {splits.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-400">Keine Zielmarke erreicht.</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {splits.map((s) => (
            <div key={s.label} className="rounded-xl bg-zinc-950 p-3">
              <div className="text-xs text-zinc-500">{s.label}</div>
              <div className="text-2xl font-semibold tabular-nums">{s.time!.toFixed(2)} s</div>
              {s.trapSpeed !== undefined && (
                <div className="text-xs text-zinc-500">{s.trapSpeed.toFixed(0)} km/h Endgeschw.</div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="mt-4">
        <LineChart
          points={result.samples.map((s) => ({ x: s.t, y: s.v }))}
          xLabel="Zeit (s)"
          yLabel="km/h"
          formatX={(x) => x.toFixed(1)}
        />
      </div>
    </section>
  )
}
