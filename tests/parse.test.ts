import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  decodeDtc,
  findError,
  parseDtcResponse,
  parsePidResponse,
  parseSupportedPids,
  parseVin,
  splitLines,
} from '../src/obd/parse'

test('PID-Antwort mit Echo und Leerzeichen', () => {
  const lines = splitLines('010C\r41 0C 1A F8 \r\r', '010C')
  assert.deepEqual(parsePidResponse(lines, 0x0c), [0x1a, 0xf8])
})

test('Unterstützte PIDs von zwei Steuergeräten', () => {
  const lines = splitLines('SEARCHING...\r4100BE3FB813\r4100980000\r')
  assert.deepEqual(parseSupportedPids(lines, 0).sort((a, b) => a - b).slice(0, 3), [1, 3, 4])
})

test('Fehlermeldungen und K-Line-Businit', () => {
  assert.equal(findError(splitLines('NO DATA\r')), 'NO DATA')
  assert.equal(findError(splitLines('BUS INIT: ...OK\r41 0C 0F A0\r')), null)
  assert.deepEqual(parsePidResponse(splitLines('BUS INIT: ...OK\r41 0C 0F A0\r'), 0x0c), [0x0f, 0xa0])
  assert.equal(findError(splitLines('BUS INIT: ...ERROR\r')), 'BUS INIT: ...ERROR')
})

test('Fehlercodes CAN (Einzel- und Mehrfachframe) und K-Line', () => {
  assert.deepEqual(parseDtcResponse(splitLines('43020133 0420\r'), 3, true), ['P0133', 'P0420'])
  assert.deepEqual(parseDtcResponse(splitLines('4300\r'), 3, true), [])
  assert.deepEqual(
    parseDtcResponse(splitLines('00A\r0: 43 04 01 33 04 20\r1: C1 23 91 00 00 00\r'), 3, true),
    ['P0133', 'P0420', 'U0123', 'B1100'],
  )
  assert.deepEqual(parseDtcResponse(splitLines('43 01 33 04 20 00 00\r'), 3, false), ['P0133', 'P0420'])
  assert.equal(decodeDtc(0x41, 0x23), 'C0123')
})

test('Fahrgestellnummer CAN und K-Line', () => {
  const can = '014\r0: 490201575657\r1: 5A5A5A314B5A41\r2: 4D353433323130\r'
  assert.equal(parseVin(splitLines(can)), 'WVWZZZ1KZAM543210')
  const kline =
    '49 02 01 00 00 00 57\r49 02 02 56 57 5A 5A\r49 02 03 5A 31 4B 5A\r49 02 04 41 4D 35 34\r49 02 05 33 32 31 30\r'
  assert.equal(parseVin(splitLines(kline)), 'WVWZZZ1KZAM543210')
})
