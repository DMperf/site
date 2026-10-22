import { useCallback, useEffect, useRef, useState } from 'react'
import type { Network } from '../net/socket'
import { Elm327 } from '../obd/elm327'
import { EnetLink } from '../obd/enetLink'
import type { VehicleIdent } from '../obd/hsfz'
import type { AdapterInfo, LogDirection, VehicleLink } from '../obd/link'
import type { Transport } from '../obd/transport'

export type Status = 'disconnected' | 'connecting' | 'connected'

export interface LogEntry {
  id: number
  time: Date
  direction: LogDirection
  text: string
}

/** Wie verbunden werden soll: ELM327 über einen Transport oder BMW ENET. */
export type ConnectSpec = (
  | { type: 'elm327'; transport: Transport }
  | { type: 'enet'; network: Network; host: string; ident: VehicleIdent | null; label: string }
) & {
  /** Simuliertes Fahrzeug – schaltet die Demo-Codierdaten frei. */
  demo?: boolean
}

const MAX_LOG = 500

export function useObd() {
  const [status, setStatus] = useState<Status>('disconnected')
  const [error, setError] = useState<string | null>(null)
  const [adapter, setAdapter] = useState<AdapterInfo | null>(null)
  const [transportLabel, setTransportLabel] = useState('')
  const [supported, setSupported] = useState<Set<number>>(new Set())
  const [demo, setDemo] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const linkRef = useRef<VehicleLink | null>(null)
  const logId = useRef(0)

  const addLog = useCallback((direction: LogDirection, text: string) => {
    setLog((prev) => {
      const next = [...prev, { id: logId.current++, time: new Date(), direction, text }]
      return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next
    })
  }, [])

  const connect = useCallback(
    async (spec: ConnectSpec) => {
      setError(null)
      setStatus('connecting')
      const lost = () => {
        addLog('error', 'Verbindung verloren')
        setError('Verbindung verloren')
        linkRef.current = null
        setStatus('disconnected')
      }

      let link: VehicleLink
      if (spec.type === 'elm327') {
        link = new Elm327(spec.transport, addLog)
        spec.transport.onDisconnect = lost
      } else {
        const enet = new EnetLink(spec.network, spec.host, spec.ident, addLog)
        enet.onDisconnect = lost
        link = enet
      }

      try {
        if (spec.type === 'elm327') {
          await spec.transport.connect()
          setTransportLabel(spec.transport.label)
        } else {
          setTransportLabel(spec.label)
        }
        addLog('info', `Verbinde über ${spec.type === 'elm327' ? spec.transport.label : spec.label}`)
        const info = await link.initialize()
        setAdapter(info)
        setSupported(await link.getSupportedPids())
        linkRef.current = link
        setDemo(spec.demo ?? false)
        setStatus('connected')
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        // Abbruch im Geräte-Dialog ist kein Fehler.
        if (!/cancel|abgebrochen|No port selected|User cancelled/i.test(message)) {
          setError(message)
          addLog('error', message)
        }
        if (spec.type === 'elm327') spec.transport.onDisconnect = null
        await link.close().catch(() => undefined)
        setStatus('disconnected')
      }
    },
    [addLog],
  )

  const disconnect = useCallback(async () => {
    const link = linkRef.current
    linkRef.current = null
    setStatus('disconnected')
    setAdapter(null)
    if (link) await link.close().catch(() => undefined)
    addLog('info', 'Getrennt')
  }, [addLog])

  useEffect(() => () => void linkRef.current?.close(), [])

  return {
    status,
    error,
    adapter,
    transportLabel,
    supported,
    demo,
    log,
    link: status === 'connected' ? linkRef.current : null,
    connect,
    disconnect,
    clearLog: () => setLog([]),
  }
}
