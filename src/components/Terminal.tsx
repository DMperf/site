import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Elm327 } from '../obd/elm327'
import type { LogEntry } from '../hooks/useObd'

interface Props {
  elm: Elm327
  log: LogEntry[]
  onClear: () => void
}

const COLORS: Record<LogEntry['direction'], string> = {
  tx: 'text-sky-400',
  rx: 'text-zinc-200',
  info: 'text-emerald-400',
  error: 'text-red-400',
}

const PREFIX: Record<LogEntry['direction'], string> = {
  tx: '>',
  rx: '<',
  info: '•',
  error: '!',
}

export function Terminal({ elm, log, onClear }: Props) {
  const [command, setCommand] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const cmd = command.trim().toUpperCase()
    if (!cmd) return
    setCommand('')
    await elm.send(cmd, 10000).catch(() => undefined)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">
        Rohbefehle an den ELM327 senden, z. B. <code>ATRV</code>, <code>ATI</code>,{' '}
        <code>010C</code> oder <code>0902</code>. Die Kommunikation der anderen Ansichten erscheint
        hier ebenfalls.
      </p>
      <div
        ref={scrollRef}
        className="h-96 overflow-y-auto rounded-2xl border border-zinc-800 bg-black p-3 font-mono text-xs"
      >
        {log.map((entry) => (
          <div key={entry.id} className={COLORS[entry.direction]}>
            <span className="text-zinc-600">{entry.time.toLocaleTimeString()} </span>
            {PREFIX[entry.direction]} {entry.text}
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm uppercase"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Befehl, z. B. ATRV"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn-small" type="submit">
          Senden
        </button>
        <button className="btn-small" type="button" onClick={onClear}>
          Leeren
        </button>
      </form>
    </div>
  )
}
