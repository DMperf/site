import { useCallback, useEffect, useRef, useState } from 'react'
import { Elm327, type AdapterInfo, type LogDirection } from '../obd/elm327'
import type { Transport } from '../obd/transport'

export type Status = 'disconnected' | 'connecting' | 'connected'

export interface LogEntry {
  id: number
  time: Date
  direction: LogDirection
  text: string
}

const MAX_LOG = 500

export function useObd() {
  const [status, setStatus] = useState<Status>('disconnected')
  const [error, setError] = useState<string | null>(null)
  const [adapter, setAdapter] = useState<AdapterInfo | null>(null)
  const [transportLabel, setTransportLabel] = useState('')
  const [supported, setSupported] = useState<Set<number>>(new Set())
  const [log, setLog] = useState<LogEntry[]>([])
  const elmRef = useRef<Elm327 | null>(null)
  const logId = useRef(0)

  const addLog = useCallback((direction: LogDirection, text: string) => {
    setLog((prev) => {
      const next = [...prev, { id: logId.current++, time: new Date(), direction, text }]
      return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next
    })
  }, [])

  const connect = useCallback(
    async (transport: Transport) => {
      setError(null)
      setStatus('connecting')
      const elm = new Elm327(transport, addLog)
      transport.onDisconnect = () => {
        addLog('error', 'Verbindung zum Dongle verloren')
        setError('Verbindung zum Dongle verloren')
        elmRef.current = null
        setStatus('disconnected')
      }
      try {
        await transport.connect()
        setTransportLabel(transport.label)
        addLog('info', `Verbunden über ${transport.label}`)
        const info = await elm.initialize()
        setAdapter(info)
        setSupported(await elm.getSupportedPids())
        elmRef.current = elm
        setStatus('connected')
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        // Abbruch im Geräte-Dialog ist kein Fehler.
        if (!/cancel|abgebrochen|No port selected|User cancelled/i.test(message)) {
          setError(message)
          addLog('error', message)
        }
        transport.onDisconnect = null
        await elm.close().catch(() => undefined)
        setStatus('disconnected')
      }
    },
    [addLog],
  )

  const disconnect = useCallback(async () => {
    const elm = elmRef.current
    elmRef.current = null
    setStatus('disconnected')
    setAdapter(null)
    if (elm) await elm.close().catch(() => undefined)
    addLog('info', 'Getrennt')
  }, [addLog])

  useEffect(() => () => void elmRef.current?.close(), [])

  return {
    status,
    error,
    adapter,
    transportLabel,
    supported,
    log,
    elm: status === 'connected' ? elmRef.current : null,
    connect,
    disconnect,
    clearLog: () => setLog([]),
  }
}
