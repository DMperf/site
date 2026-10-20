import { useState } from 'react'
import type { Elm327 } from '../obd/elm327'
import { AccelPanel } from './AccelPanel'
import { DynoPanel } from './DynoPanel'

export function PerformancePanel({ elm }: { elm: Elm327 }) {
  const [view, setView] = useState<'accel' | 'dyno'>('accel')
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900 p-1 text-sm">
        {(
          [
            ['accel', 'Beschleunigung'],
            ['dyno', 'Leistung'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`rounded-lg px-4 py-1.5 ${view === id ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'accel' ? <AccelPanel elm={elm} /> : <DynoPanel elm={elm} />}
    </div>
  )
}
