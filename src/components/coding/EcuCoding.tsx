import { useEffect, useMemo, useState } from 'react'
import {
  applyOption,
  diffParameters,
  featureState,
  formatValue,
  getValue,
  setValue,
} from '../../coding/engine'
import { loadBackups, matchesEcu, readCoding, targetKey, writeCoding } from '../../coding/store'
import type { CodingBackup, CodingData, CodingDefinition, CodingParameter } from '../../coding/types'
import type { VehicleLink } from '../../obd/link'
import { toHex, Uds } from '../../obd/uds'
import { Switch } from './Switch'

interface Props {
  link: VehicleLink
  def: CodingDefinition
  expert: boolean
  onBack: () => void
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Funktionen eines Steuergeräts – wie in BimmerCode: umschalten, dann gesammelt codieren. */
export function EcuCoding({ link, def, expert, onBack }: Props) {
  const [original, setOriginal] = useState<CodingData | null>(null)
  const [draft, setDraft] = useState<CodingData | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [mismatch, setMismatch] = useState(false)
  const [view, setView] = useState<'features' | 'params'>('features')
  const [query, setQuery] = useState('')
  const [backups, setBackups] = useState<CodingBackup[]>([])

  const uds = useMemo(() => new Uds(link), [link])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await link.setTarget(def.target)
        const matches = await matchesEcu(uds, def)
        const data = await readCoding(uds, def)
        if (cancelled) return
        setMismatch(!matches)
        setOriginal(data)
        setDraft(data)
      } catch (e) {
        if (!cancelled) setError(errorText(e))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    setBackups(loadBackups().filter((b) => targetKey(b.target) === targetKey(def.target)))
    return () => {
      cancelled = true
      void link.setTarget(null).catch(() => undefined)
    }
  }, [link, uds, def])

  const changes = original && draft ? diffParameters(def, original, draft) : []
  const changedIds = new Set(changes.map((c) => c.parameter.id))

  const code = async () => {
    if (!original || !draft) return
    const list = changes
      .map((c) => `• ${c.parameter.name}: ${formatValue(c.parameter, c.before)} → ${formatValue(c.parameter, c.after)}`)
      .join('\n')
    const ok = window.confirm(
      `${def.name} codieren?\n\n${list}\n\nZündung an, Motor aus, Batterie stabil (Ladegerät empfohlen). ` +
        'Der bisherige Stand wird gesichert.',
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await writeCoding(link, def, original, draft)
      setOriginal(result.data)
      setDraft(result.data)
      setBackups(loadBackups().filter((b) => targetKey(b.target) === targetKey(def.target)))
      if (result.verified) {
        setNotice('Codierung erfolgreich. Zündung aus- und wieder einschalten, damit die Änderungen wirken.')
      } else {
        setError('Achtung: Die zurückgelesenen Daten weichen ab. Bitte erneut lesen und prüfen.')
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const restore = async (backup: CodingBackup) => {
    if (!original) return
    const ok = window.confirm(
      `Stand vom ${new Date(backup.date).toLocaleString('de-DE')} wiederherstellen?\n\n` +
        `Block ${backup.did.toString(16).toUpperCase()}: ${toHex(backup.before)}`,
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await writeCoding(link, def, original, { ...original, [backup.did]: backup.before })
      setOriginal(result.data)
      setDraft(result.data)
      setBackups(loadBackups().filter((b) => targetKey(b.target) === targetKey(def.target)))
      setNotice(result.verified ? 'Sicherung wiederhergestellt.' : 'Wiederhergestellt, aber Rücklesen weicht ab.')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const categories = [...new Set(def.features.map((f) => f.category))]
  const params = def.parameters.filter((p) =>
    `${p.name} ${p.id}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button className="btn-small shrink-0 whitespace-nowrap" onClick={onBack} disabled={busy && !error}>
          ← Steuergeräte
        </button>
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{def.name}</h2>
          <p className="truncate text-xs text-zinc-500">{def.brand}</p>
        </div>
      </div>

      {mismatch && (
        <p className="rounded-xl border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-200">
          Die Kennung des Steuergeräts passt nicht zu diesen Codierdaten. Nur codieren, wenn du sicher bist,
          dass sie für dieses Gerät gelten.
        </p>
      )}
      {error && <p className="rounded-xl border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}
      {notice && (
        <p className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-3 text-sm text-emerald-300">{notice}</p>
      )}
      {busy && !draft && <p className="animate-pulse text-sm text-zinc-400">Lese Codierung …</p>}

      {draft && expert && (
        <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900 p-1 text-sm">
          {(
            [
              ['features', 'Funktionen'],
              ['params', `Alle Parameter (${def.parameters.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`rounded-lg px-4 py-1.5 ${view === id ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {draft && (view === 'features' || !expert) && (
        <>
          {def.features.length === 0 && (
            <p className="text-sm text-zinc-400">
              Für dieses Steuergerät sind keine Funktionen hinterlegt. Im Expertenmodus lassen sich die
              Parameter einzeln ändern.
            </p>
          )}
          {categories.map((category) => (
            <section key={category} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
              <h3 className="border-b border-zinc-800 px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                {category}
              </h3>
              <ul className="divide-y divide-zinc-800">
                {def.features
                  .filter((f) => f.category === category)
                  .map((feature) => {
                    const state = featureState(def, feature, draft)
                    const changed = Object.keys(feature.options[0].set).some((id) => changedIds.has(id))
                    return (
                      <li key={feature.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm">
                            {changed && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="geändert" />}
                            <span>{feature.name}</span>
                          </div>
                          {feature.description && (
                            <p className="mt-0.5 text-xs text-zinc-500">{feature.description}</p>
                          )}
                        </div>
                        {feature.kind === 'toggle' && state !== -1 ? (
                          <Switch
                            label={feature.name}
                            checked={state === 1}
                            disabled={busy}
                            onChange={(on) => setDraft(applyOption(def, feature, on ? 1 : 0, draft))}
                          />
                        ) : (
                          <select
                            className="max-w-[45%] rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
                            value={state}
                            disabled={busy}
                            aria-label={feature.name}
                            onChange={(e) => setDraft(applyOption(def, feature, Number(e.target.value), draft))}
                          >
                            {state === -1 && <option value={-1}>individuell</option>}
                            {feature.options.map((o, i) => (
                              <option key={o.name} value={i}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </li>
                    )
                  })}
              </ul>
            </section>
          ))}
        </>
      )}

      {draft && expert && view === 'params' && (
        <section className="space-y-3">
          <input
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            placeholder="Parameter suchen …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="divide-y divide-zinc-800 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
            {params.map((p) => (
              <ParameterRow
                key={p.id}
                param={p}
                data={draft}
                original={original!}
                disabled={busy}
                onChange={(value) => setDraft(setValue(draft, p, value))}
              />
            ))}
          </ul>
          <details className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm">
            <summary className="cursor-pointer text-zinc-400">Rohdaten</summary>
            <dl className="mt-3 space-y-2 font-mono text-xs">
              {Object.entries(draft).map(([did, bytes]) => (
                <div key={did}>
                  <dt className="text-zinc-500">DID {Number(did).toString(16).toUpperCase().padStart(4, '0')}</dt>
                  <dd className="break-all">{toHex(bytes)}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      )}

      {draft && backups.length > 0 && (
        <details className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm">
          <summary className="cursor-pointer text-zinc-400">Wiederherstellen ({backups.length} Sicherungen)</summary>
          <ul className="mt-3 divide-y divide-zinc-800">
            {backups.map((b) => (
              <li key={`${b.date}-${b.did}`} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div>{new Date(b.date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</div>
                  {expert && <div className="truncate font-mono text-xs text-zinc-500">{toHex(b.before)}</div>}
                </div>
                <button className="btn-small" disabled={busy} onClick={() => void restore(b)}>
                  Wiederherstellen
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {changes.length > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-800 bg-zinc-950/95 px-4 pt-3 backdrop-blur"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <span className="mr-auto text-sm">
              {changes.length} {changes.length === 1 ? 'Änderung' : 'Änderungen'}
            </span>
            <button className="btn-small" disabled={busy} onClick={() => setDraft(original)}>
              Verwerfen
            </button>
            <button
              className="rounded-xl bg-red-600 px-5 py-2 font-medium text-white hover:bg-red-500 disabled:opacity-40"
              disabled={busy}
              onClick={() => void code()}
            >
              {busy ? 'Codiere …' : 'Codieren'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface RowProps {
  param: CodingParameter
  data: CodingData
  original: CodingData
  disabled: boolean
  onChange: (value: number) => void
}

function ParameterRow({ param, data, original, disabled, onChange }: RowProps) {
  const value = getValue(data, param)
  const changed = value !== getValue(original, param)
  const factor = param.numeric?.factor ?? 1
  const location = `${param.did.toString(16).toUpperCase()} · Byte ${param.byte}${
    param.mask !== undefined ? ` · Maske ${param.mask.toString(16).toUpperCase().padStart(2, '0')}` : ''
  }`
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          {changed && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="geändert" />}
          <span>{param.name}</span>
        </div>
        <div className="truncate font-mono text-xs text-zinc-500">
          {param.id} · {location}
        </div>
      </div>
      {param.values ? (
        <select
          className="max-w-[45%] rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
          value={value ?? ''}
          disabled={disabled}
          aria-label={param.name}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {!param.values.some((v) => v.value === value) && <option value={value ?? ''}>{formatValue(param, value)}</option>}
          {param.values.map((v) => (
            <option key={v.value} value={v.value}>
              {v.name}
            </option>
          ))}
        </select>
      ) : (
        <label className="flex items-center gap-1 text-sm">
          <input
            type="number"
            className="w-20 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-right"
            value={value === null ? '' : value * factor}
            min={(param.numeric?.min ?? 0) * factor}
            max={(param.numeric?.max ?? 255) * factor}
            step={factor}
            disabled={disabled}
            aria-label={param.name}
            onChange={(e) => {
              const raw = Math.round(Number(e.target.value) / factor)
              const min = param.numeric?.min ?? 0
              const max = param.numeric?.max ?? 255
              if (Number.isFinite(raw) && raw >= min && raw <= max) onChange(raw)
            }}
          />
          {param.numeric?.unit && <span className="text-zinc-500">{param.numeric.unit}</span>}
        </label>
      )}
    </li>
  )
}
