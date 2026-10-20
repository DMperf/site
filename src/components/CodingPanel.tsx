import { useEffect, useState } from 'react'
import type { CanTarget, Elm327 } from '../obd/elm327'
import {
  CODING_DIDS,
  describeStatus,
  ECU_PRESETS,
  IDENT_DIDS,
  parseHex,
  toAscii,
  toHex,
  Uds,
  UdsError,
  type EcuDtc,
} from '../obd/uds'
import { downloadFile, load, save } from '../storage'

interface Backup {
  date: string
  ecu: string
  did: string
  before: string
  after: string
}

const BACKUP_KEY = 'obd.coding.backups'
const hex3 = (n: number) => n.toString(16).toUpperCase().padStart(3, '0')
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function CodingPanel({ elm }: { elm: Elm327 }) {
  const [presetKey, setPresetKey] = useState('0:0')
  const [custom, setCustom] = useState({ tx: '7E0', rx: '7E8' })
  const [target, setTarget] = useState<CanTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ident, setIdent] = useState<{ name: string; value: string }[]>([])
  const [dtcs, setDtcs] = useState<EcuDtc[] | null>(null)
  const uds = new Uds(elm)

  // Beim Verlassen der Ansicht wieder auf OBD-Broadcast umstellen.
  useEffect(() => () => void elm.setTarget(null).catch(() => undefined), [elm])

  if (!elm.isCan11Bit) {
    return (
      <p className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
        Codierung (UDS) wird nur bei Fahrzeugen mit 11-bit-CAN-Bus unterstützt. Dein Fahrzeug nutzt ein
        anderes Protokoll.
      </p>
    )
  }

  const selectedTarget = (): CanTarget | null => {
    if (presetKey === 'custom') {
      const tx = parseInt(custom.tx, 16)
      const rx = parseInt(custom.rx, 16)
      return Number.isNaN(tx) || Number.isNaN(rx) ? null : { tx, rx }
    }
    const [g, e] = presetKey.split(':').map(Number)
    return ECU_PRESETS[g].ecus[e].target
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
      if (!t) throw new Error('Ungültige CAN-Adresse')
      await elm.setTarget(t)
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
      await elm.setTarget(null)
      setTarget(null)
      setIdent([])
      setDtcs(null)
    })

  const ecuName = target ? `${hex3(target.tx)}/${hex3(target.rx)}` : ''

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
            {ECU_PRESETS.map((g, gi) => (
              <optgroup key={g.group} label={g.group}>
                {g.ecus.map((e, ei) => (
                  <option key={e.name} value={`${gi}:${ei}`}>
                    {e.name} – {hex3(e.target.tx)}/{hex3(e.target.rx)}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value="custom">Eigene Adresse …</option>
          </select>
          {presetKey === 'custom' && (
            <>
              {(['tx', 'rx'] as const).map((k) => (
                <label key={k} className="text-xs text-zinc-400">
                  {k === 'tx' ? 'Anfrage-ID' : 'Antwort-ID'}
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

          <DidEditor uds={uds} ecuName={ecuName} busy={busy} guard={guard} />
        </>
      )}
    </div>
  )
}

interface EditorProps {
  uds: Uds
  ecuName: string
  busy: boolean
  guard: (fn: () => Promise<void>) => Promise<void>
}

function DidEditor({ uds, ecuName, busy, guard }: EditorProps) {
  const [didInput, setDidInput] = useState(hex4(CODING_DIDS[0].did))
  const [original, setOriginal] = useState<number[] | null>(null)
  const [draft, setDraft] = useState<number[]>([])
  const [selectedByte, setSelectedByte] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [backups, setBackups] = useState<Backup[]>(() => load(BACKUP_KEY, []))

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
      const backup: Backup = {
        date: new Date().toISOString(),
        ecu: ecuName,
        did: hex4(did),
        before: toHex(original),
        after: toHex(draft),
      }
      const next = [backup, ...backups].slice(0, 100)
      setBackups(next)
      save(BACKUP_KEY, next)
      try {
        await uds.session(0x03)
        await uds.writeDid(did, draft)
      } catch (e) {
        if (e instanceof UdsError && e.code === 0x33) {
          throw new Error(
            'Das Steuergerät verlangt eine Freischaltung (Security Access). Diese ist herstellerspezifisch und wird nicht unterstützt.',
          )
        }
        throw e
      }
      const verify = await uds.readDid(did)
      await uds.session(0x01).catch(() => undefined)
      setOriginal(verify)
      setDraft(verify)
      setStatus(
        toHex(verify) === toHex(draft)
          ? 'Geschrieben und erfolgreich zurückgelesen. Zündung aus- und wieder einschalten, damit die Änderung wirkt.'
          : `Achtung: Rückgelesener Wert weicht ab (${toHex(verify)}).`,
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

      {backups.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-400">Sicherungen ({backups.length})</summary>
          <ul className="mt-2 space-y-2">
            {backups.map((b) => (
              <li key={b.date} className="rounded-lg bg-zinc-950 p-2 font-mono text-xs">
                <div className="text-zinc-500">
                  {new Date(b.date).toLocaleString('de-DE')} · {b.ecu} · DID {b.did}
                </div>
                <div>Alt: {b.before}</div>
                <div>Neu: {b.after}</div>
              </li>
            ))}
          </ul>
          <button
            className="btn-small mt-2"
            onClick={() =>
              downloadFile('codier-sicherungen.json', JSON.stringify(backups, null, 2), 'application/json')
            }
          >
            Als Datei speichern
          </button>
        </details>
      )}
    </section>
  )
}
