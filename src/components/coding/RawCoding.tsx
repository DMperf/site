import { useEffect, useState } from 'react'
import { isAddressTarget, type EcuTarget, type VehicleLink } from '../../obd/link'
import {
  CODING_DIDS,
  CAN_ECU_PRESETS,
  describeStatus,
  ENET_ECU_PRESETS,
  IDENT_DIDS,
  parseHex,
  toAscii,
  toHex,
  Uds,
  type EcuDtc,
} from '../../obd/uds'
import { writeCoding } from '../../coding/store'

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
const hex3 = (n: number) => n.toString(16).toUpperCase().padStart(3, '0')
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const targetName = (t: EcuTarget) =>
  isAddressTarget(t) ? `0x${hex2(t.address)}` : `${hex3(t.tx)}/${hex3(t.rx)}`

/** Expertenmodus: beliebiges Steuergerät, Fehlerspeicher und Rohdaten (DIDs) lesen/schreiben. */
export function RawCoding({ link }: { link: VehicleLink }) {
  const [presetKey, setPresetKey] = useState('0:0')
  const [custom, setCustom] = useState({ tx: '7E0', rx: '7E8', address: '12' })
  const [target, setTarget] = useState<EcuTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ident, setIdent] = useState<{ name: string; value: string }[]>([])
  const [dtcs, setDtcs] = useState<EcuDtc[] | null>(null)
  const uds = new Uds(link)
  const enet = link.kind === 'enet'
  const presets = enet ? ENET_ECU_PRESETS : CAN_ECU_PRESETS

  // Beim Verlassen der Ansicht wieder auf OBD-Broadcast umstellen.
  useEffect(() => () => void link.setTarget(null).catch(() => undefined), [link])

  if (!link.supportsUds) {
    return (
      <p className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
        Codierung (UDS) wird nur bei Fahrzeugen mit 11-bit-CAN-Bus unterstützt. Dein Fahrzeug nutzt ein
        anderes Protokoll.
      </p>
    )
  }

  const selectedTarget = (): EcuTarget | null => {
    if (presetKey === 'custom' && enet) {
      const address = parseInt(custom.address, 16)
      return Number.isNaN(address) || address > 0xff ? null : { address }
    }
    if (presetKey === 'custom') {
      const tx = parseInt(custom.tx, 16)
      const rx = parseInt(custom.rx, 16)
      return Number.isNaN(tx) || Number.isNaN(rx) ? null : { tx, rx }
    }
    const [g, e] = presetKey.split(':').map(Number)
    return presets[g].ecus[e].target
  }

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const connect = () =>
    guard(async () => {
      const t = selectedTarget()
      if (!t) throw new Error('Ungültige Adresse')
      await link.setTarget(t)
      setDtcs(null)
      // Erreichbarkeit prüfen, bevor Daten gelesen werden.
      await uds.session(0x01)
      setTarget(t)
      const rows: { name: string; value: string }[] = []
      for (const d of IDENT_DIDS) {
        try {
          const value = await uds.readDid(d.did)
          rows.push({ name: d.name, value: d.ascii ? toAscii(value) || toHex(value) : toHex(value) })
        } catch {
          // Nicht jedes Steuergerät kennt jede Kennung.
        }
      }
      setIdent(rows)
    })

  const disconnect = () =>
    guard(async () => {
      await link.setTarget(null)
      setTarget(null)
      setIdent([])
      setDtcs(null)
    })

  const ecuName = target ? targetName(target) : ''

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-amber-900 bg-amber-950/40 p-4 text-sm text-amber-200">
        <b>Achtung:</b> Falsche Codierwerte können Steuergeräte funktionsunfähig machen. Vor dem Schreiben
        wird der alte Wert automatisch gesichert. Nur bei eingeschalteter Zündung, stehendem Motor und
        stabiler Bordspannung (Ladegerät empfohlen) codieren.
      </div>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="font-medium">Steuergerät</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <select
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
            value={presetKey}
            disabled={!!target || busy}
            onChange={(e) => setPresetKey(e.target.value)}
            aria-label="Steuergerät"
          >
            {presets.map((g, gi) => (
              <optgroup key={g.group} label={g.group}>
                {g.ecus.map((e, ei) => (
                  <option key={e.name} value={`${gi}:${ei}`}>
                    {e.name} – {targetName(e.target)}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value="custom">Eigene Adresse …</option>
          </select>
          {presetKey === 'custom' && (
            <>
              {(enet ? (['address'] as const) : (['tx', 'rx'] as const)).map((k) => (
                <label key={k} className="text-xs text-zinc-400">
                  {k === 'tx' ? 'Anfrage-ID' : k === 'rx' ? 'Antwort-ID' : 'Diagnoseadresse'}
                  <input
                    className="mt-1 block w-20 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-2 font-mono text-sm uppercase"
                    value={custom[k]}
                    disabled={!!target}
                    onChange={(e) => setCustom({ ...custom, [k]: e.target.value })}
                  />
                </label>
              ))}
            </>
          )}
          {target ? (
            <button className="btn-small" disabled={busy} onClick={disconnect}>
              Trennen
            </button>
          ) : (
            <button className="btn-small" disabled={busy} onClick={connect}>
              {busy ? 'Verbinde …' : 'Verbinden'}
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        {target && ident.length > 0 && (
          <dl className="mt-4 divide-y divide-zinc-800 text-sm">
            {ident.map((r) => (
              <div key={r.name} className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3">
                <dt className="text-zinc-400">{r.name}</dt>
                <dd className="font-mono sm:col-span-2">{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {target && (
        <>
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="mr-auto font-medium">Fehlerspeicher dieses Steuergeräts</h3>
              <button
                className="btn-small"
                disabled={busy}
                onClick={() => guard(async () => setDtcs(await uds.readDtcs()))}
              >
                Auslesen
              </button>
              <button
                className="btn-small border-red-800 text-red-400"
                disabled={busy || !dtcs?.length}
                onClick={() => {
                  if (!window.confirm('Fehlerspeicher dieses Steuergeräts löschen?')) return
                  void guard(async () => {
                    await uds.clearDtcs()
                    setDtcs(await uds.readDtcs())
                  })
                }}
              >
                Löschen
              </button>
            </div>
            {dtcs &&
              (dtcs.length === 0 ? (
                <p className="mt-3 text-sm text-emerald-400">Keine Fehler gespeichert</p>
              ) : (
                <ul className="mt-3 divide-y divide-zinc-800 text-sm">
                  {dtcs.map((d) => (
                    <li key={d.code} className="flex gap-4 py-2">
                      <span className="w-24 font-mono font-semibold text-red-400">{d.code}</span>
                      <span className="text-zinc-300">{describeStatus(d.status)}</span>
                    </li>
                  ))}
                </ul>
              ))}
          </section>

          <DidEditor link={link} uds={uds} target={target} ecuName={ecuName} busy={busy} guard={guard} />
        </>
      )}
    </div>
  )
}

interface EditorProps {
  link: VehicleLink
  target: EcuTarget
  uds: Uds
  ecuName: string
  busy: boolean
  guard: (fn: () => Promise<void>) => Promise<void>
}

function DidEditor({ link, target, uds, ecuName, busy, guard }: EditorProps) {
  const [didInput, setDidInput] = useState(hex4(CODING_DIDS[0].did))
  const [original, setOriginal] = useState<number[] | null>(null)
  const [draft, setDraft] = useState<number[]>([])
  const [selectedByte, setSelectedByte] = useState(0)
  const [status, setStatus] = useState<string | null>(null)

  const did = parseInt(didInput, 16)
  const validDid = /^[0-9A-Fa-f]{4}$/.test(didInput)
  const changed = original !== null && toHex(original) !== toHex(draft)

  const read = () =>
    guard(async () => {
      setStatus(null)
      const value = await uds.readDid(did)
      setOriginal(value)
      setDraft(value)
      setSelectedByte(0)
    })

  const write = () => {
    if (!original) return
    const ok = window.confirm(
      `Steuergerät ${ecuName}, Kennung ${hex4(did)}\n\n` +
        `Alt: ${toHex(original)}\nNeu: ${toHex(draft)}\n\nWirklich schreiben?`,
    )
    if (!ok) return
    void guard(async () => {
      const { verified, data } = await writeCoding(
        link,
        { id: '', name: ecuName, target },
        { [did]: original },
        { [did]: draft },
      )
      setOriginal(data[did])
      setDraft(data[did])
      setStatus(
        verified
          ? 'Geschrieben und erfolgreich zurückgelesen. Zündung aus- und wieder einschalten, damit die Änderung wirkt.'
          : `Achtung: Rückgelesener Wert weicht ab (${toHex(data[did])}).`,
      )
    })
  }

  const toggleBit = (bit: number) =>
    setDraft((d) => d.map((b, i) => (i === selectedByte ? b ^ (1 << bit) : b)))

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="font-medium">Codierung / Datenkennung (DID)</h3>
      <div className="flex flex-wrap items-end gap-3">
        <select
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
          value={CODING_DIDS.some((d) => hex4(d.did) === didInput.toUpperCase()) ? didInput.toUpperCase() : ''}
          onChange={(e) => e.target.value && setDidInput(e.target.value)}
          aria-label="Vordefinierte Kennung"
        >
          {CODING_DIDS.map((d) => (
            <option key={d.did} value={hex4(d.did)}>
              {hex4(d.did)} – {d.name}
            </option>
          ))}
          <option value="">Eigene Kennung</option>
        </select>
        <label className="text-xs text-zinc-400">
          DID (hex)
          <input
            className="mt-1 block w-24 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-2 font-mono text-sm uppercase"
            value={didInput}
            onChange={(e) => {
              setDidInput(e.target.value)
              setOriginal(null)
            }}
          />
        </label>
        <button className="btn-small" disabled={busy || !validDid} onClick={read}>
          Lesen
        </button>
      </div>

      {original && (
        <>
          <div>
            <div className="text-xs text-zinc-500">
              Wert ({draft.length} Byte){toAscii(original) && ` · ASCII: ${toAscii(original)}`}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {draft.map((b, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedByte(i)}
                  className={`w-12 rounded-md border py-1.5 font-mono text-sm ${
                    i === selectedByte ? 'border-red-600 bg-zinc-800' : 'border-zinc-700'
                  } ${b !== original[i] ? 'text-amber-300' : ''}`}
                  title={`Byte ${i}`}
                >
                  {b.toString(16).toUpperCase().padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>

          {draft.length > 0 && (
            <div>
              <div className="text-xs text-zinc-500">Byte {selectedByte} – Bits</div>
              <div className="mt-2 flex gap-1.5">
                {[7, 6, 5, 4, 3, 2, 1, 0].map((bit) => {
                  const on = (draft[selectedByte] >> bit) & 1
                  const changedBit = on !== ((original[selectedByte] >> bit) & 1)
                  return (
                    <button
                      key={bit}
                      onClick={() => toggleBit(bit)}
                      className={`flex w-10 flex-col items-center rounded-md border py-1 text-xs ${
                        on ? 'border-red-600 bg-red-600/20' : 'border-zinc-700'
                      } ${changedBit ? 'ring-1 ring-amber-400' : ''}`}
                    >
                      <span className="text-zinc-500">Bit {bit}</span>
                      <span className="font-mono text-sm">{on}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <label className="block text-xs text-zinc-400">
            Oder kompletten Wert als Hex eingeben
            <input
              className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-2 font-mono text-sm uppercase"
              defaultValue={toHex(original)}
              key={toHex(original)}
              onChange={(e) => {
                const bytes = parseHex(e.target.value)
                if (bytes) setDraft(bytes)
              }}
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
              disabled={busy || !changed}
              onClick={write}
            >
              Schreiben
            </button>
            <button className="btn-small" disabled={busy || !changed} onClick={() => setDraft(original)}>
              Änderungen verwerfen
            </button>
          </div>
          {status && <p className="text-sm text-emerald-400">{status}</p>}
        </>
      )}

    </section>
  )
}
