import { useEffect, useRef, useState } from 'react'
import type { VehicleLink } from '../obd/link'
import { BOOST, DEFAULT_SELECTION, PIDS, PID_BY_ID } from '../obd/pids'
import { Sparkline } from './Sparkline'

interface Props {
  link: VehicleLink
  supported: Set<number>
}

interface Reading {
  value: number | null
  history: number[]
}

interface Gauge {
  key: string
  name: string
  unit: string
  min: number
  max: number
  decimals: number
}

const HISTORY = 60

export function LiveData({ link, supported }: Props) {
  const available = PIDS.filter((p) => supported.has(p.pid))
  const [selected, setSelected] = useState<number[]>(() =>
    DEFAULT_SELECTION.filter((p) => supported.has(p)),
  )
  const [running, setRunning] = useState(true)
  const [readings, setReadings] = useState<Record<string, Reading>>({})
  const [rate, setRate] = useState(0)
  const [recording, setRecording] = useState(false)
  const [rowCount, setRowCount] = useState(0)
  const rows = useRef<Record<string, number | string | null>[]>([])
  const recordingRef = useRef(recording)
  recordingRef.current = recording

  const showBoost = supported.has(0x0b) && supported.has(0x33)

  useEffect(() => {
    if (!running || selected.length === 0) return
    let cancelled = false
    let baro = 101

    const poll = async () => {
      // Luftdruck ändert sich kaum – einmal zu Beginn lesen.
      if (showBoost) baro = (await link.readPid(PID_BY_ID.get(0x33)!).catch(() => null)) ?? baro

      while (!cancelled) {
        const started = performance.now()
        const cycle: Record<string, number | null> = {}
        for (const pid of selected) {
          if (cancelled) return
          const def = PID_BY_ID.get(pid)!
          cycle[pid] = await link.readPid(def).catch(() => null)
        }
        if (cancelled) return
        if (showBoost && cycle[0x0b] != null) cycle[BOOST.key] = (cycle[0x0b]! - baro) / 100

        setReadings((prev) => {
          const next = { ...prev }
          for (const [key, value] of Object.entries(cycle)) {
            const history = prev[key]?.history ?? []
            next[key] = {
              value,
              history: value == null ? history : [...history, value].slice(-HISTORY),
            }
          }
          return next
        })
        if (recordingRef.current) {
          rows.current.push({ zeit: new Date().toISOString(), ...cycle })
          setRowCount(rows.current.length)
        }
        setRate(1000 / (performance.now() - started))
      }
    }
    void poll()
    return () => {
      cancelled = true
    }
  }, [link, running, selected, showBoost])

  const toggle = (pid: number) =>
    setSelected((prev) => (prev.includes(pid) ? prev.filter((p) => p !== pid) : [...prev, pid]))

  const exportCsv = () => {
    const keys = ['zeit', ...selected.map(String), ...(showBoost ? [BOOST.key] : [])]
    const header = keys.map((k) => {
      if (k === 'zeit') return 'Zeit'
      const def = k === BOOST.key ? BOOST : PID_BY_ID.get(Number(k))!
      return `${def.name} [${def.unit}]`
    })
    const lines = [header.join(';')]
    for (const row of rows.current) {
      lines.push(keys.map((k) => String(row[k] ?? '').replace('.', ',')).join(';'))
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `obd-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const gauges: Gauge[] = [
    ...selected.map((pid) => ({ ...PID_BY_ID.get(pid)!, key: String(pid) })),
    ...(showBoost && selected.includes(0x0b) ? [BOOST] : []),
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-small" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Start'}
        </button>
        <button
          className={`btn-small ${recording ? 'border-red-600 text-red-400' : ''}`}
          onClick={() => {
            if (!recording) {
              rows.current = []
              setRowCount(0)
            }
            setRecording((r) => !r)
          }}
        >
          {recording ? '● Aufnahme stoppen' : 'Aufnahme starten'}
        </button>
        <button className="btn-small" disabled={rowCount === 0 || recording} onClick={exportCsv}>
          CSV exportieren ({rowCount})
        </button>
        <span className="ml-auto text-xs text-zinc-500">
          {running ? `${rate.toFixed(1)} Zyklen/s` : 'pausiert'}
        </span>
      </div>

      {gauges.length === 0 ? (
        <p className="text-zinc-400">Keine Messwerte ausgewählt.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {gauges.map((g) => (
            <GaugeCard key={g.key} gauge={g} reading={readings[g.key]} />
          ))}
        </div>
      )}

      <details className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Messwerte auswählen ({selected.length} von {available.length} unterstützten)
        </summary>
        <p className="mt-2 text-xs text-zinc-500">
          Weniger Messwerte = schnellere Aktualisierung.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {available.map((p) => (
            <label key={p.pid} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-red-600"
                checked={selected.includes(p.pid)}
                onChange={() => toggle(p.pid)}
              />
              {p.name}
              <span className="text-xs text-zinc-500">
                PID {p.pid.toString(16).toUpperCase().padStart(2, '0')}
              </span>
            </label>
          ))}
        </div>
      </details>
    </div>
  )
}

function GaugeCard({ gauge, reading }: { gauge: Gauge; reading?: Reading }) {
  const value = reading?.value
  const fraction =
    value == null ? 0 : Math.min(1, Math.max(0, (value - gauge.min) / (gauge.max - gauge.min)))
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="truncate text-xs uppercase tracking-wide text-zinc-400" title={gauge.name}>
        {gauge.name}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tabular-nums">
          {value == null ? '–' : value.toFixed(gauge.decimals)}
        </span>
        <span className="text-sm text-zinc-500">{gauge.unit}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-red-600 transition-[width] duration-200"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <div className="mt-2 text-red-500/70">
        <Sparkline values={reading?.history ?? []} min={gauge.min} max={gauge.max} />
      </div>
    </div>
  )
}
