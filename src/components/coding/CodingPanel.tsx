import { useRef, useState, type ChangeEvent } from 'react'
import {
  availableDefinitions,
  loadImported,
  matchesEcu,
  parseDefinitionFile,
  saveImported,
} from '../../coding/store'
import type { CodingDefinition } from '../../coding/types'
import { isAddressTarget, type EcuTarget, type VehicleLink } from '../../obd/link'
import { Uds } from '../../obd/uds'
import { load, save } from '../../storage'
import { EcuCoding } from './EcuCoding'
import { RawCoding } from './RawCoding'
import { Switch } from './Switch'

interface Props {
  link: VehicleLink
  demo: boolean
}

type ScanState = 'found' | 'mismatch' | 'missing'

const EXPERT_KEY = 'obd.coding.expert'

const targetText = (t: EcuTarget) =>
  isAddressTarget(t)
    ? `0x${t.address.toString(16).toUpperCase().padStart(2, '0')}`
    : `${t.tx.toString(16).toUpperCase()}/${t.rx.toString(16).toUpperCase()}`

/** Codierung im Stil von BimmerCode: Steuergerät wählen, Funktionen umschalten, codieren. */
export function CodingPanel({ link, demo }: Props) {
  const [expert, setExpert] = useState(() => load(EXPERT_KEY, false))
  const [selected, setSelected] = useState<CodingDefinition | null>(null)
  const [raw, setRaw] = useState(false)
  const [scan, setScan] = useState<Record<string, ScanState>>({})
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  // Nach Import/Löschen neu rendern; die Listen kommen direkt aus dem Speicher.
  const [, setVersion] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const definitions = availableDefinitions(link, demo)
  const imported = loadImported()

  if (!link.supportsUds) {
    return (
      <p className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
        Codierung wird nur bei Fahrzeugen mit 11-bit-CAN-Bus (ELM327) oder über ENET unterstützt.
      </p>
    )
  }

  if (selected) {
    return <EcuCoding link={link} def={selected} expert={expert} onBack={() => setSelected(null)} />
  }

  if (raw) {
    return (
      <div className="space-y-4">
        <button className="btn-small" onClick={() => setRaw(false)}>
          ← Steuergeräte
        </button>
        <RawCoding link={link} />
      </div>
    )
  }

  const toggleExpert = (on: boolean) => {
    setExpert(on)
    save(EXPERT_KEY, on)
  }

  const runScan = async () => {
    setScanning(true)
    setMessage(null)
    const uds = new Uds(link)
    const result: Record<string, ScanState> = {}
    for (const def of definitions) {
      try {
        await link.setTarget(def.target)
        await uds.session(0x01)
        result[def.id] = (await matchesEcu(uds, def)) ? 'found' : 'mismatch'
      } catch {
        result[def.id] = 'missing'
      }
      setScan({ ...result })
    }
    await link.setTarget(null).catch(() => undefined)
    setScanning(false)
  }

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const defs = parseDefinitionFile(await file.text())
      const ids = new Set(defs.map((d) => d.id))
      saveImported([...loadImported().filter((d) => !ids.has(d.id)), ...defs])
      setVersion((v) => v + 1)
      setMessage({ ok: true, text: `${defs.length} Steuergerät(e) importiert: ${defs.map((d) => d.name).join(', ')}` })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
  }

  const removeImported = (id: string) => {
    if (!window.confirm('Diese Codierdaten entfernen?')) return
    saveImported(loadImported().filter((d) => d.id !== id))
    setVersion((v) => v + 1)
  }

  const groups = [...new Set(definitions.map((d) => d.brand))]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3">
        <div className="flex-1">
          <div className="text-sm font-medium">Expertenmodus</div>
          <div className="text-xs text-zinc-500">Alle Parameter, Rohdaten und beliebige Steuergeräte</div>
        </div>
        <Switch label="Expertenmodus" checked={expert} onChange={toggleExpert} />
      </div>

      {definitions.length > 0 ? (
        <>
          <div className="flex items-center gap-3">
            <h2 className="mr-auto font-semibold">Steuergeräte</h2>
            <button className="btn-small" disabled={scanning} onClick={() => void runScan()}>
              {scanning ? 'Suche …' : 'Fahrzeug prüfen'}
            </button>
          </div>
          {groups.map((brand) => (
            <section key={brand} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
              <h3 className="border-b border-zinc-800 px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                {brand}
              </h3>
              <ul className="divide-y divide-zinc-800">
                {definitions
                  .filter((d) => d.brand === brand)
                  .map((def) => (
                    <li key={def.id}>
                      <button
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/60 disabled:opacity-40"
                        disabled={scanning || scan[def.id] === 'missing'}
                        onClick={() => setSelected(def)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm">{def.name}</div>
                          <div className="text-xs text-zinc-500">
                            {targetText(def.target)} · {def.features.length} Funktionen
                            {expert && ` · ${def.parameters.length} Parameter`}
                          </div>
                        </div>
                        <ScanBadge state={scan[def.id]} />
                        <span className="text-zinc-600">›</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </>
      ) : (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-400">
          <h2 className="font-semibold text-zinc-100">Keine Codierdaten für dieses Fahrzeug</h2>
          <p className="mt-2">
            Damit Funktionen wie in BimmerCode per Schalter änderbar sind, braucht die App für jedes Steuergerät
            Codierdaten: welches Bit welche Funktion steuert. Diese hängen vom Steuergerät und seinem Softwarestand
            ab und sind nicht in der App enthalten. Du kannst sie als Datei importieren (Format siehe
            docs/codierdaten.md) – oder im Expertenmodus die Rohdaten direkt bearbeiten.
          </p>
          {demo || (
            <p className="mt-2">Zum Ausprobieren: Demo-Fahrzeug verbinden, dort sind Beispiel-Codierdaten hinterlegt.</p>
          )}
        </section>
      )}

      {message && (
        <p
          className={`whitespace-pre-line rounded-xl border p-3 text-sm ${
            message.ok ? 'border-emerald-900 bg-emerald-950/40 text-emerald-300' : 'border-red-900 bg-red-950/50 text-red-300'
          }`}
        >
          {message.text}
        </p>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="mr-auto text-sm font-medium">Codierdaten</h3>
          <button className="btn-small" onClick={() => fileInput.current?.click()}>
            Datei importieren
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => void importFile(e)} />
        </div>
        {imported.length > 0 ? (
          <ul className="mt-3 divide-y divide-zinc-800 text-sm">
            {imported.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{d.name}</div>
                  <div className="truncate text-xs text-zinc-500">
                    {d.brand} · {targetText(d.target)}
                    {d.description ? ` · ${d.description}` : ''}
                  </div>
                </div>
                <button className="text-xs text-zinc-500 hover:text-red-400" onClick={() => removeImported(d.id)}>
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-zinc-500">Noch keine eigenen Codierdaten importiert.</p>
        )}
      </section>

      {expert && (
        <button
          className="flex w-full items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-left hover:bg-zinc-800/60"
          onClick={() => setRaw(true)}
        >
          <div className="flex-1">
            <div className="text-sm">Beliebiges Steuergerät (Rohdaten)</div>
            <div className="text-xs text-zinc-500">Adresse wählen, Kennungen lesen/schreiben, Fehlerspeicher</div>
          </div>
          <span className="text-zinc-600">›</span>
        </button>
      )}

      <p className="text-xs text-zinc-500">
        Codieren nur bei eingeschalteter Zündung, stehendem Motor und stabiler Bordspannung (Ladegerät empfohlen).
        Vor jedem Schreiben wird der bisherige Stand gesichert und lässt sich wiederherstellen.
      </p>
    </div>
  )
}

function ScanBadge({ state }: { state?: ScanState }) {
  if (!state) return null
  const map: Record<ScanState, [string, string]> = {
    found: ['bg-emerald-950 text-emerald-300', 'erkannt'],
    mismatch: ['bg-amber-950 text-amber-300', 'andere Version'],
    missing: ['bg-zinc-800 text-zinc-400', 'nicht gefunden'],
  }
  const [cls, label] = map[state]
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>
}
