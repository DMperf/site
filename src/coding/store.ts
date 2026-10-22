import { isAddressTarget, type EcuTarget, type VehicleLink } from '../obd/link'
import { parseHex, Uds, UdsError } from '../obd/uds'
import { load, save } from '../storage'
import { DEMO_ELM_DEFINITIONS, DEMO_ENET_DEFINITIONS } from './demoDefinitions'
import { changedBlocks, validateDefinition } from './engine'
import type { CodingBackup, CodingData, CodingDefinition } from './types'

const IMPORTED_KEY = 'obd.coding.definitions'
const BACKUP_KEY = 'obd.coding.backups.v2'
const MAX_BACKUPS = 200

export const targetKey = (t: EcuTarget) => (isAddressTarget(t) ? `a${t.address}` : `c${t.tx}-${t.rx}`)

export function loadImported(): CodingDefinition[] {
  return load<CodingDefinition[]>(IMPORTED_KEY, []).filter((d) => validateDefinition(d).length === 0)
}

export function saveImported(defs: CodingDefinition[]) {
  save(IMPORTED_KEY, defs)
}

/** Alle Definitionen, die zur Verbindungsart passen (ENET: Adressen, ELM327: CAN-IDs). */
export function availableDefinitions(link: VehicleLink, demo: boolean): CodingDefinition[] {
  const builtIn = demo ? (link.kind === 'enet' ? DEMO_ENET_DEFINITIONS : DEMO_ELM_DEFINITIONS) : []
  const imported = loadImported().filter((d) => !d.demoOnly || demo)
  return [...builtIn, ...imported].filter((d) => isAddressTarget(d.target) === (link.kind === 'enet'))
}

const NUMERIC_KEYS = new Set(['address', 'tx', 'rx', 'did', 'byte', 'mask', 'length', 'value', 'session', 'min', 'max'])

/** Erlaubt Hex-Schreibweise ("0x3000") für Zahlenfelder in Importdateien. */
function normalizeNumbers(input: unknown, key = ''): unknown {
  if (Array.isArray(input)) return input.map((x) => normalizeNumbers(x, key))
  if (input && typeof input === 'object') {
    return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, normalizeNumbers(v, k)]))
  }
  if (typeof input === 'string' && NUMERIC_KEYS.has(key) && /^0x[0-9a-f]+$/i.test(input)) {
    return parseInt(input, 16)
  }
  return input
}

/**
 * Prüft eine importierte Datei. Erlaubt ist eine einzelne Definition oder eine Liste.
 * Liefert die gültigen Definitionen oder wirft mit allen Fehlern.
 */
export function parseDefinitionFile(text: string): CodingDefinition[] {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.')
  }
  json = normalizeNumbers(json)
  const list = Array.isArray(json) ? json : [json]
  const errors = list.flatMap((d, i) => validateDefinition(d).map((e) => `#${i + 1}: ${e}`))
  if (errors.length) throw new Error(errors.slice(0, 8).join('\n'))
  return list as CodingDefinition[]
}

export function loadBackups(): CodingBackup[] {
  return load<CodingBackup[]>(BACKUP_KEY, [])
}

function addBackups(entries: CodingBackup[]) {
  save(BACKUP_KEY, [...entries, ...loadBackups()].slice(0, MAX_BACKUPS))
}

/** Liest alle Codierblöcke einer Definition. */
export async function readCoding(uds: Uds, def: CodingDefinition): Promise<CodingData> {
  const data: CodingData = {}
  for (const block of def.blocks) {
    const value = await uds.readDid(block.did)
    if (value.length !== block.length) {
      throw new Error(
        `Codierblock ${block.did.toString(16).toUpperCase()} hat ${value.length} statt ${block.length} Byte – ` +
          'die Codierdaten passen nicht zu diesem Steuergerät.',
      )
    }
    data[block.did] = value
  }
  return data
}

/** Prüft, ob die Erkennungsmerkmale der Definition zum Steuergerät passen. */
export async function matchesEcu(uds: Uds, def: CodingDefinition): Promise<boolean> {
  for (const m of def.match ?? []) {
    const value = await uds.readDid(m.did).catch(() => null)
    const text = value ? String.fromCharCode(...value) : ''
    if (!text.startsWith(m.startsWith)) return false
  }
  return true
}

export interface WriteResult {
  verified: boolean
  data: CodingData
}

/**
 * Schreibt geänderte Codierblöcke: Sicherung anlegen, Diagnosesitzung öffnen,
 * schreiben, zurücklesen und vergleichen.
 */
export async function writeCoding(
  link: VehicleLink,
  def: Pick<CodingDefinition, 'id' | 'name' | 'target' | 'session' | 'beforeWrite' | 'afterWrite'> & {
    demoOnly?: boolean
  },
  before: CodingData,
  after: CodingData,
): Promise<WriteResult> {
  const uds = new Uds(link)
  const dids = changedBlocks(before, after)
  if (dids.length === 0) return { verified: true, data: before }

  const date = new Date().toISOString()
  addBackups(
    dids.map((did) => ({
      date,
      definitionId: def.id || null,
      ecuName: def.name,
      target: def.target,
      did,
      before: before[did],
      after: after[did],
    })),
  )

  try {
    await uds.session(def.session ?? 0x03)
    for (const hex of def.beforeWrite ?? []) await link.request(parseHex(hex)!)
    for (const did of dids) await uds.writeDid(did, after[did])
    for (const hex of def.afterWrite ?? []) await link.request(parseHex(hex)!)
  } catch (e) {
    if (e instanceof UdsError && e.code === 0x33) {
      throw new Error(
        'Das Steuergerät verlangt eine Freischaltung (Security Access). Diese ist herstellerspezifisch und wird nicht unterstützt.',
      )
    }
    throw e
  }

  const verify: CodingData = { ...before }
  for (const did of dids) verify[did] = await uds.readDid(did)
  await uds.session(0x01).catch(() => undefined)
  return { verified: changedBlocks(after, verify).length === 0, data: verify }
}
