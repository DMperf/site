import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ByteSocket, Network } from '../src/net/socket'
import { discoverVehicles, EnetLink } from '../src/obd/enetLink'
import { CTRL, encodeFrame, FrameReader } from '../src/obd/hsfz'
import { PID_BY_ID } from '../src/obd/pids'
import { Uds } from '../src/obd/uds'
import { SIM_ENET_IP, SimulatedEnetNetwork } from '../src/sim/hsfzGateway'

// EnetLink nutzt window.setTimeout (Browser); in Node auf globalThis abbilden.
;(globalThis as unknown as { window: typeof globalThis }).window = globalThis

test('FrameReader setzt byteweise ankommende Rahmen zusammen', () => {
  const reader = new FrameReader()
  const bytes = [...encodeFrame(1, [0x12, 0xf4, 0x62, 0xf1, 0x90]), ...encodeFrame(2, [1, 2])]
  const frames = bytes.flatMap((b) => reader.push(new Uint8Array([b])))
  assert.equal(frames.length, 2)
  assert.deepEqual(frames[0].payload, [0x12, 0xf4, 0x62, 0xf1, 0x90])
  assert.equal(frames[1].control, 2)
})

test('ENET gegen simuliertes BMW-Gateway', async () => {
  const net = new SimulatedEnetNetwork()
  const [vehicle] = await discoverVehicles(net)
  assert.equal(vehicle.vin, 'WBA8E9C50GK123456')
  assert.equal(vehicle.mac, '001A37C0FFEE')

  const link = new EnetLink(net, SIM_ENET_IP, vehicle)
  await link.initialize()
  const supported = await link.getSupportedPids()
  assert.ok(supported.has(0x0c) && supported.has(0x5c))
  assert.ok((await link.readPid(PID_BY_ID.get(0x0c)!))! >= 800)
  assert.deepEqual(await link.readDtcs(0x03), ['P0133', 'P0420'])
  assert.equal(await link.readVin(), 'WBA8E9C50GK123456')

  const uds = new Uds(link)
  await link.setTarget({ address: 0x12 })
  assert.equal(String.fromCharCode(...(await uds.readDid(0xf190))), 'WBA8E9C50GK123456')
  const before = await uds.readDid(0x0600)
  await uds.session(0x03)
  await uds.writeDid(0x0600, before.map((b, i) => (i === 0 ? b ^ 1 : b)))
  assert.equal((await uds.readDid(0x0600))[0], before[0] ^ 1)
  await assert.rejects(uds.writeDid(0xf190, [1]), /Security Access/)
  assert.equal((await uds.readDtcs()).length, 2)
  assert.deepEqual(await link.sendRaw('12 22 F1 89'), ['62 F1 89 30 30 30 33'])
  await assert.rejects(link.transact(0x55, [0x22, 0xf1, 0x90], 300), /Keine Antwort/)

  // Parallele Anfragen werden serialisiert.
  const values = await Promise.all([0x0c, 0x0d, 0x05].map((p) => link.readPid(PID_BY_ID.get(p)!)))
  assert.ok(values.every((v) => v !== null))
  await link.close()
})

test('NACK wird wiederholt, Alive-Check beantwortet, Response Pending abgewartet', async () => {
  let diagWrites = 0
  const sent: number[][] = []
  const network: Network = {
    async udpRequest() {
      return []
    },
    async connectTcp() {
      const socket: ByteSocket = {
        onData: null,
        onClose: null,
        async close() {},
        async write(b) {
          sent.push([...b])
          if (b[5] !== CTRL.DIAG) return
          diagWrites++
          const payload = [...b.slice(6)]
          const emit = (frame: Uint8Array, ms: number) => setTimeout(() => socket.onData?.(frame), ms)
          if (diagWrites === 1) return emit(encodeFrame(CTRL.NACK, []), 5)
          emit(encodeFrame(CTRL.ALIVE_CHECK, []), 2)
          emit(encodeFrame(CTRL.ACK, payload), 5)
          emit(encodeFrame(CTRL.DIAG, [0x12, 0xf4, 0x7f, 0x01, 0x78]), 10)
          emit(encodeFrame(CTRL.DIAG, [0x12, 0xf4, 0x41, 0x00, 0xbe, 0x3f, 0xb8, 0x13]), 30)
        },
      }
      return socket
    },
  }
  const link = new EnetLink(network, '1.2.3.4', { address: '1.2.3.4', vin: null, mac: null })
  await link.initialize()
  assert.equal(diagWrites, 2, 'nach NACK erneut gesendet')
  assert.ok(sent.some((s) => s[5] === CTRL.ALIVE_RESPONSE && s[7] === 0xf4), 'Alive-Check beantwortet')
})
