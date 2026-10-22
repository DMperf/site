import { useCallback, useEffect, useState } from 'react'
import type { VehicleLink } from '../obd/link'
import { DTC_DESCRIPTIONS } from '../obd/dtcDescriptions'

interface Props {
  link: VehicleLink
}

interface DtcState {
  stored: string[]
  pending: string[]
  permanent: string[]
}

const SECTIONS: { key: keyof DtcState; title: string; hint: string }[] = [
  { key: 'stored', title: 'Gespeichert', hint: 'Bestätigte Fehler, Motorkontrollleuchte (Mode 03)' },
  { key: 'pending', title: 'Ausstehend', hint: 'Im aktuellen/letzten Fahrzyklus erkannt (Mode 07)' },
  { key: 'permanent', title: 'Permanent', hint: 'Lassen sich nicht löschen, verschwinden nach Reparatur (Mode 0A)' },
]

export function DtcPanel({ link }: Props) {
  const [dtcs, setDtcs] = useState<DtcState | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const read = useCallback(async () => {
    setBusy(true)
    setMessage(null)
    try {
      setDtcs({
        stored: await link.readDtcs(0x03),
        pending: await link.readDtcs(0x07),
        permanent: await link.readDtcs(0x0a),
      })
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [link])

  useEffect(() => {
    void read()
  }, [read])

  const clear = async () => {
    const ok = window.confirm(
      'Fehlerspeicher wirklich löschen?\n\n' +
        'Dabei werden auch Freeze-Frame-Daten und Readiness-Monitore zurückgesetzt. ' +
        'Nur bei stehendem Motor und eingeschalteter Zündung ausführen.',
    )
    if (!ok) return
    setBusy(true)
    let result = 'Fehlerspeicher gelöscht.'
    try {
      await link.clearDtcs()
    } catch (e) {
      result = e instanceof Error ? e.message : String(e)
    }
    await read()
    setMessage(result)
  }

  const total = dtcs ? dtcs.stored.length + dtcs.pending.length : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <button className="btn-small" disabled={busy} onClick={read}>
          {busy ? 'Lese …' : 'Fehler auslesen'}
        </button>
        <button
          className="btn-small border-red-800 text-red-400"
          disabled={busy || total === 0}
          onClick={clear}
        >
          Fehlerspeicher löschen
        </button>
      </div>

      {message && <p className="text-sm text-amber-400">{message}</p>}

      {dtcs &&
        SECTIONS.map(({ key, title, hint }) => (
          <section key={key} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h3 className="font-medium">
              {title} <span className="text-zinc-500">({dtcs[key].length})</span>
            </h3>
            <p className="text-xs text-zinc-500">{hint}</p>
            {dtcs[key].length === 0 ? (
              <p className="mt-3 text-sm text-emerald-400">Keine Fehler</p>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-800">
                {dtcs[key].map((code) => (
                  <li key={code} className="flex gap-4 py-2 text-sm">
                    <span className="w-16 font-mono font-semibold text-red-400">{code}</span>
                    <span className="text-zinc-300">
                      {DTC_DESCRIPTIONS[code] ?? 'Herstellerspezifisch / keine Beschreibung hinterlegt'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
    </div>
  )
}
