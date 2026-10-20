import { useState } from 'react'
import { CodingPanel } from './components/CodingPanel'
import { ConnectPanel } from './components/ConnectPanel'
import { DtcPanel } from './components/DtcPanel'
import { LiveData } from './components/LiveData'
import { PerformancePanel } from './components/PerformancePanel'
import { Terminal } from './components/Terminal'
import { VehicleInfo } from './components/VehicleInfo'
import { useObd } from './hooks/useObd'

type Tab = 'live' | 'perf' | 'dtc' | 'coding' | 'info' | 'terminal'

const TABS: { id: Tab; label: string }[] = [
  { id: 'live', label: 'Live-Daten' },
  { id: 'perf', label: 'Performance' },
  { id: 'dtc', label: 'Fehlercodes' },
  { id: 'coding', label: 'Codierung' },
  { id: 'info', label: 'Fahrzeug' },
  { id: 'terminal', label: 'Terminal' },
]

export default function App() {
  const obd = useObd()
  const [tab, setTab] = useState<Tab>('live')
  const { elm, adapter } = obd

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-4">
          <div className="whitespace-nowrap text-lg font-bold tracking-tight">
            DM <span className="text-red-600">Performance</span>
            <span className="ml-2 text-sm font-normal text-zinc-500">OBD</span>
          </div>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <StatusDot status={obd.status} />
            {obd.status === 'connected' && (
              <>
                <span className="hidden text-zinc-400 sm:inline">{obd.transportLabel}</span>
                <button className="btn-small" onClick={obd.disconnect}>
                  Trennen
                </button>
              </>
            )}
          </div>
        </div>
        {elm && (
          <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm ${
                  tab === t.id
                    ? 'border-red-600 text-white'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {!elm || !adapter ? (
          <ConnectPanel status={obd.status} error={obd.error} onConnect={obd.connect} />
        ) : (
          <>
            {tab === 'live' && <LiveData elm={elm} supported={obd.supported} />}
            {tab === 'perf' && <PerformancePanel elm={elm} />}
            {tab === 'dtc' && <DtcPanel elm={elm} />}
            {tab === 'coding' && <CodingPanel elm={elm} />}
            {tab === 'info' && (
              <VehicleInfo
                elm={elm}
                adapter={adapter}
                transportLabel={obd.transportLabel}
                supported={obd.supported}
              />
            )}
            {tab === 'terminal' && <Terminal elm={elm} log={obd.log} onClear={obd.clearLog} />}
          </>
        )}
      </main>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    disconnected: ['bg-zinc-600', 'Nicht verbunden'],
    connecting: ['bg-amber-500 animate-pulse', 'Verbinde …'],
    connected: ['bg-emerald-500', 'Verbunden'],
  }
  const [color, label] = map[status]
  return (
    <span className="flex items-center gap-2 text-zinc-300">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  )
}
