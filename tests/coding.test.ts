import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEMO_ENET_DEFINITIONS } from '../src/coding/demoDefinitions'
import {
  applyOption,
  changedBlocks,
  diffParameters,
  featureState,
  getValue,
  setValue,
  validateDefinition,
} from '../src/coding/engine'
import { readCoding, writeCoding } from '../src/coding/store'
import type { CodingParameter } from '../src/coding/types'
import { EnetLink } from '../src/obd/enetLink'
import { Uds } from '../src/obd/uds'
import { SIM_ENET_IP, SimulatedEnetNetwork } from '../src/sim/hsfzGateway'

;(globalThis as unknown as { window: typeof globalThis }).window = globalThis

const param = (x: Partial<CodingParameter>): CodingParameter => ({ id: 'P', name: 'P', did: 1, byte: 0, ...x })

test('Bitmasken lesen und setzen, ohne Nachbarbits zu verändern', () => {
  const data = { 1: [0b1011_0110, 0xff] }
  const p = param({ mask: 0x0c })
  assert.equal(getValue(data, p), 0b01)
  const next = setValue(data, p, 0b10)
  assert.equal(next[1][0], 0b1011_1010)
  assert.deepEqual(data[1], [0b1011_0110, 0xff], 'Original unverändert')
  assert.throws(() => setValue(data, p, 4), /passt nicht/)
})

test('Mehrbyte-Zahlen (Big Endian)', () => {
  const p = param({ byte: 1, length: 2 })
  const data = setValue({ 1: [0, 0, 0, 9] }, p, 0x1234)
  assert.deepEqual(data[1], [0, 0x12, 0x34, 9])
  assert.equal(getValue(data, p), 0x1234)
})

test('Funktionszustand, Änderungen und geänderte Blöcke', () => {
  const def = DEMO_ENET_DEFINITIONS[0]
  const data = { 0x3000: [0x00, 0x02, 0, 0, 0, 0, 0, 0] }
  const sport = def.features.find((f) => f.id === 'sport')!
  assert.equal(featureState(def, sport, data), 0)
  const next = applyOption(def, sport, 2, data)
  assert.equal(featureState(def, sport, next), 2)
  assert.equal(next[0x3000][0], 0x08)
  assert.deepEqual(
    diffParameters(def, data, next).map((c) => [c.parameter.id, c.before, c.after]),
    [['SPORTANZEIGE', 0, 2]],
  )
  assert.deepEqual(changedBlocks(data, next), [0x3000])
  // Unbekannter Zustand → -1
  assert.equal(featureState(def, sport, { 0x3000: [0x0c, 0, 0, 0, 0, 0, 0, 0] }), -1)
})

test('Demo-Codierdaten sind gültig', () => {
  for (const def of DEMO_ENET_DEFINITIONS) assert.deepEqual(validateDefinition(def), [], def.id)
})

test('Fehlerhafte Importdateien werden abgelehnt', () => {
  const good = DEMO_ENET_DEFINITIONS[0]
  assert.ok(validateDefinition(null).length > 0)
  const outside = { ...good, parameters: [{ ...good.parameters[0], byte: 8 }] }
  assert.match(validateDefinition(outside).join(), /außerhalb/)
  const badValue = { ...good, parameters: [{ ...good.parameters[0], values: [{ value: 2, name: 'x' }] }] }
  assert.match(validateDefinition(badValue).join(), /passt nicht in die Maske/)
  const badFeature = {
    ...good,
    features: [{ ...good.features[0], options: [{ name: 'a', set: { GIBTS_NICHT: 1 } }, { name: 'b', set: {} }] }],
  }
  assert.match(validateDefinition(badFeature).join(), /unbekannter Parameter/)
  assert.match(validateDefinition({ ...good, target: { foo: 1 } }).join(), /target/)
})

test('Codieren über ENET: schreiben, zurücklesen, Sicherung wiederherstellen', async () => {
  const def = DEMO_ENET_DEFINITIONS[1]
  const link = new EnetLink(new SimulatedEnetNetwork(), SIM_ENET_IP, null)
  await link.initialize()
  const uds = new Uds(link)
  await link.setTarget(def.target)
  const before = await readCoding(uds, def)

  const msa = def.features.find((f) => f.id === 'msa')!
  const heim = def.features.find((f) => f.id === 'heim')!
  let after = applyOption(def, msa, 1, before)
  after = applyOption(def, heim, 3, after)
  const result = await writeCoding(link, def, before, after)
  assert.ok(result.verified)
  const reread = await readCoding(uds, def)
  assert.equal(featureState(def, msa, reread), 1)
  assert.equal(featureState(def, heim, reread), 3)

  // Wiederherstellen = alten Block zurückschreiben
  const restored = await writeCoding(link, def, reread, before)
  assert.ok(restored.verified)
  assert.deepEqual(await readCoding(uds, def), before)
  await link.close()
})

test('Importdatei mit Hex-Schreibweise (docs/codierdaten-beispiel.json)', async () => {
  const { readFileSync } = await import('node:fs')
  const { parseDefinitionFile } = await import('../src/coding/store')
  const [def] = parseDefinitionFile(readFileSync('docs/codierdaten-beispiel.json', 'utf8'))
  assert.deepEqual(def.target, { address: 0x60 })
  assert.equal(def.blocks[0].did, 0x3000)
  assert.equal(def.parameters.find((p) => p.id === 'SPORTANZEIGE')!.mask, 0x0c)
  assert.throws(() => parseDefinitionFile('{kaputt'), /kein gültiges JSON/)
})
