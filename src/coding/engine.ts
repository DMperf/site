import type { CodingData, CodingDefinition, CodingFeature, CodingParameter } from './types'

const lowestBit = (mask: number) => {
  let shift = 0
  while (shift < 8 && !(mask & (1 << shift))) shift++
  return shift
}

/** Liest den Rohwert eines Parameters aus den Codierdaten. */
export function getValue(data: CodingData, p: CodingParameter): number | null {
  const block = data[p.did]
  const length = p.length ?? 1
  if (!block || p.byte + length > block.length) return null
  if (length > 1) {
    let value = 0
    for (let i = 0; i < length; i++) value = value * 256 + block[p.byte + i]
    return value
  }
  const mask = p.mask ?? 0xff
  return (block[p.byte] & mask) >> lowestBit(mask)
}

/** Liefert neue Codierdaten mit gesetztem Parameter (Original bleibt unverändert). */
export function setValue(data: CodingData, p: CodingParameter, value: number): CodingData {
  const block = data[p.did]
  const length = p.length ?? 1
  if (!block || p.byte + length > block.length) throw new Error(`Parameter ${p.id} liegt außerhalb der Daten`)
  const next = [...block]
  if (length > 1) {
    if (value < 0 || value >= 256 ** length) throw new Error(`Wert ${value} passt nicht in ${p.id}`)
    for (let i = length - 1; i >= 0; i--) {
      next[p.byte + i] = value % 256
      value = Math.floor(value / 256)
    }
  } else {
    const mask = p.mask ?? 0xff
    const shift = lowestBit(mask)
    if (value < 0 || value > mask >> shift) throw new Error(`Wert ${value} passt nicht in ${p.id}`)
    next[p.byte] = (next[p.byte] & ~mask & 0xff) | ((value << shift) & mask)
  }
  return { ...data, [p.did]: next }
}

export const paramById = (def: CodingDefinition) => new Map(def.parameters.map((p) => [p.id, p]))

/** Welche Option einer Funktion gerade aktiv ist (-1 = keine passt, z. B. herstellerspezifisch). */
export function featureState(def: CodingDefinition, feature: CodingFeature, data: CodingData): number {
  const params = paramById(def)
  return feature.options.findIndex((o) =>
    Object.entries(o.set).every(([id, v]) => {
      const p = params.get(id)
      return p !== undefined && getValue(data, p) === v
    }),
  )
}

export function applyOption(
  def: CodingDefinition,
  feature: CodingFeature,
  option: number,
  data: CodingData,
): CodingData {
  const params = paramById(def)
  let next = data
  for (const [id, value] of Object.entries(feature.options[option].set)) {
    next = setValue(next, params.get(id)!, value)
  }
  return next
}

/** Lesbarer Wert eines Parameters. */
export function formatValue(p: CodingParameter, value: number | null): string {
  if (value === null) return '–'
  const named = p.values?.find((v) => v.value === value)
  if (named) return named.name
  if (p.numeric) {
    const shown = value * (p.numeric.factor ?? 1)
    return `${shown}${p.numeric.unit ? ` ${p.numeric.unit}` : ''}`
  }
  return `0x${value.toString(16).toUpperCase()}`
}

export interface Change {
  parameter: CodingParameter
  before: number | null
  after: number | null
}

/** Unterschiede zwischen zwei Ständen, je Parameter. */
export function diffParameters(def: CodingDefinition, before: CodingData, after: CodingData): Change[] {
  return def.parameters
    .map((p) => ({ parameter: p, before: getValue(before, p), after: getValue(after, p) }))
    .filter((c) => c.before !== c.after)
}

/** DIDs, deren Bytes sich geändert haben. */
export function changedBlocks(before: CodingData, after: CodingData): number[] {
  return Object.keys(after)
    .map(Number)
    .filter((did) => (before[did] ?? []).join() !== (after[did] ?? []).join())
}

const isHex = (s: unknown) => typeof s === 'string' && /^([0-9a-fA-F]{2}\s*)+$/.test(s.trim())

/**
 * Prüft eine (importierte) Codierdefinition gründlich. Liefert eine Liste
 * verständlicher Fehler; leer = in Ordnung.
 */
export function validateDefinition(input: unknown): string[] {
  const errors: string[] = []
  const d = input as Partial<CodingDefinition>
  if (!d || typeof d !== 'object') return ['Keine gültige JSON-Definition']
  if (typeof d.id !== 'string' || !d.id) errors.push('"id" fehlt')
  if (typeof d.name !== 'string' || !d.name) errors.push('"name" fehlt')
  if (typeof d.brand !== 'string') errors.push('"brand" fehlt')
  const t = d.target as Record<string, unknown> | undefined
  const validTarget =
    t &&
    ((typeof t.address === 'number' && t.address >= 0 && t.address <= 0xff) ||
      (typeof t.tx === 'number' && typeof t.rx === 'number'))
  if (!validTarget) errors.push('"target" braucht { "address": … } oder { "tx": …, "rx": … }')
  if (!Array.isArray(d.blocks) || d.blocks.length === 0) errors.push('"blocks" fehlt')
  const blocks = new Map((d.blocks ?? []).map((b) => [b.did, b.length]))
  for (const b of d.blocks ?? []) {
    if (typeof b.did !== 'number' || typeof b.length !== 'number' || b.length < 1) {
      errors.push(`Ungültiger Block ${JSON.stringify(b)}`)
    }
  }
  for (const s of [...(d.beforeWrite ?? []), ...(d.afterWrite ?? [])]) {
    if (!isHex(s)) errors.push(`Ungültige Hex-Anfrage "${s}"`)
  }

  const ids = new Set<string>()
  for (const p of d.parameters ?? []) {
    const where = `Parameter ${p.id ?? '?'}`
    if (typeof p.id !== 'string' || ids.has(p.id)) errors.push(`${where}: "id" fehlt oder doppelt`)
    ids.add(p.id)
    const length = p.length ?? 1
    const blockLength = blocks.get(p.did)
    if (blockLength === undefined) errors.push(`${where}: DID ${p.did} ist in "blocks" nicht aufgeführt`)
    else if (typeof p.byte !== 'number' || p.byte < 0 || p.byte + length > blockLength) {
      errors.push(`${where}: Byte ${p.byte} liegt außerhalb des Blocks`)
    }
    if (p.mask !== undefined && (length > 1 || p.mask <= 0 || p.mask > 0xff)) {
      errors.push(`${where}: Maske nur für 1-Byte-Werte (1–FF)`)
    }
    const max = length > 1 ? 256 ** length - 1 : (p.mask ?? 0xff) >> lowestBit(p.mask ?? 0xff)
    for (const v of p.values ?? []) {
      if (typeof v.value !== 'number' || v.value < 0 || v.value > max) {
        errors.push(`${where}: Wert ${v.value} passt nicht in die Maske`)
      }
    }
  }
  if (!Array.isArray(d.parameters)) errors.push('"parameters" fehlt')

  for (const f of d.features ?? []) {
    const where = `Funktion ${f.id ?? '?'}`
    if (!Array.isArray(f.options) || f.options.length < 2) errors.push(`${where}: mindestens zwei Optionen nötig`)
    if (f.kind === 'toggle' && f.options?.length !== 2) errors.push(`${where}: Schalter brauchen genau zwei Optionen`)
    for (const o of f.options ?? []) {
      for (const [id, value] of Object.entries(o.set ?? {})) {
        const p = (d.parameters ?? []).find((x) => x.id === id)
        if (!p) errors.push(`${where}: unbekannter Parameter ${id}`)
        else if (p.values && !p.values.some((v) => v.value === value)) {
          errors.push(`${where}: Wert ${value} ist für ${id} nicht definiert`)
        }
      }
    }
  }
  if (!Array.isArray(d.features)) errors.push('"features" fehlt')
  return errors
}
