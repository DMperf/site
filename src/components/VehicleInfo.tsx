import { useEffect, useState } from 'react'
import type { AdapterInfo, VehicleLink } from '../obd/link'

interface Props {
  link: VehicleLink
  adapter: AdapterInfo
  transportLabel: string
  supported: Set<number>
}

export function VehicleInfo({ link, adapter, transportLabel, supported }: Props) {
  const [vin, setVin] = useState<string | null | undefined>(undefined)
  const [voltage, setVoltage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const v = await link.readBatteryVoltage().catch(() => null)
      if (!cancelled) setVoltage(v)
      const vinResult = await link.readVin().catch(() => null)
      if (!cancelled) setVin(vinResult)
    })()
    return () => {
      cancelled = true
    }
  }, [link])

  const rows: [string, string][] = [
    ['Fahrgestellnummer (VIN)', vin === undefined ? 'wird gelesen …' : (vin ?? 'nicht verfügbar')],
    ['Hersteller-Kennung (WMI)', vin ? vin.slice(0, 3) : '–'],
    ['Modelljahr-Code', vin ? vin[9] : '–'],
    ['Bordspannung', voltage ?? '–'],
    ['OBD-Protokoll', adapter.protocol],
    ['CAN-Bus', adapter.isCan ? 'ja' : 'nein'],
    ['Adapter', adapter.version],
    ['Verbindung', transportLabel],
    ['Unterstützte Mode-01-PIDs', String(supported.size)],
  ]

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900">
      <dl className="divide-y divide-zinc-800">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-3">
            <dt className="text-sm text-zinc-400">{label}</dt>
            <dd className="font-mono text-sm sm:col-span-2">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
