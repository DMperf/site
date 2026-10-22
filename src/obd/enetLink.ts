import type { ByteSocket, Network } from '../net/socket'
import {
  CTRL,
  encodeDiag,
  encodeFrame,
  FrameReader,
  HSFZ_DIAG_PORT,
  HSFZ_IDENT_PORT,
  IDENT_REQUEST,
  parseIdent,
  TESTER_ADDRESS,
  type HsfzFrame,
  type VehicleIdent,
} from './hsfz'
import {
  isAddressTarget,
  LinkError,
  type AdapterInfo,
  type EcuTarget,
  type Logger,
  type Timed,
  type VehicleLink,
} from './link'
import { dtcsFromMessages, pidFromMessages, supportedFromMessages, vinFromMessages } from './parse'
import type { PidDef } from './pids'
import { PID_BY_ID } from './pids'

const ACK_TIMEOUT_MS = 2000
const DME = 0x12
const EGS = 0x18

const toHex = (bytes: number[]) =>
  bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

/** Sucht Fahrzeuge per UDP-Broadcast (bzw. Unicast an eine bekannte IP). */
export async function discoverVehicles(
  network: Network,
  host = '255.255.255.255',
  timeoutMs = 1500,
): Promise<VehicleIdent[]> {
  const replies = await network.udpRequest(host, HSFZ_IDENT_PORT, IDENT_REQUEST, timeoutMs)
  const found = new Map<string, VehicleIdent>()
  for (const r of replies) {
    const ident = parseIdent(r.address, r.data)
    if (ident) found.set(ident.address, ident)
  }
  return [...found.values()]
}

/** BMW-Diagnose über ENET-Kabel bzw. WLAN-ENET-Adapter (HSFZ, TCP-Port 6801). */
export class EnetLink implements VehicleLink {
  readonly kind = 'enet' as const
  readonly supportsUds = true
  readonly terminalHint =
    'UDS-Anfragen als Hex senden: zuerst die Steuergeräteadresse, dann die Daten, z. B. „12 22 F1 90“ (DME, Fahrgestellnummer).'
  readonly terminalPlaceholder = 'z. B. 12 22 F1 90'

  private socket: ByteSocket | null = null
  private reader = new FrameReader()
  private inbox: HsfzFrame[] = []
  private notify: (() => void) | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private target: number | null = null
  private network: Network
  private host: string
  private ident: VehicleIdent | null
  private log: Logger
  onDisconnect: (() => void) | null = null

  constructor(network: Network, host: string, ident: VehicleIdent | null, log: Logger = () => {}) {
    this.network = network
    this.host = host
    this.ident = ident
    this.log = log
  }

  async initialize(): Promise<AdapterInfo> {
    this.log('info', `Verbinde mit ${this.host}:${HSFZ_DIAG_PORT} …`)
    const socket = await this.network.connectTcp(this.host, HSFZ_DIAG_PORT, 5000)
    this.socket = socket
    socket.onData = this.handleData
    socket.onClose = (error) => {
      this.socket = null
      this.log('error', `ENET-Verbindung getrennt${error ? `: ${error}` : ''}`)
      this.onDisconnect?.()
    }
    if (!this.ident) {
      this.ident = (await discoverVehicles(this.network, this.host, 1000).catch(() => []))[0] ?? null
    }
    // Erreichbarkeit der Motorsteuerung prüfen.
    await this.transact(DME, [0x01, 0x00])
    return {
      version: `ENET · Gateway ${this.host}`,
      protocol: 'BMW HSFZ über Ethernet (ENET)',
      isCan: true,
    }
  }

  private handleData = (bytes: Uint8Array) => {
    for (const frame of this.reader.push(bytes)) {
      if (frame.control === CTRL.ALIVE_CHECK) {
        // Gateway prüft, ob der Tester noch da ist.
        void this.socket?.write(encodeFrame(CTRL.ALIVE_RESPONSE, [0x00, TESTER_ADDRESS]))
        continue
      }
      this.inbox.push(frame)
      this.notify?.()
    }
  }

  /** Wartet auf den ersten passenden Rahmen im Posteingang. */
  private async nextFrame(match: (f: HsfzFrame) => boolean, timeoutMs: number): Promise<HsfzFrame | null> {
    const deadline = performance.now() + timeoutMs
    for (;;) {
      const i = this.inbox.findIndex(match)
      if (i >= 0) return this.inbox.splice(i, 1)[0]
      const remaining = deadline - performance.now()
      if (remaining <= 0) return null
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, remaining)
        this.notify = () => {
          clearTimeout(timer)
          resolve()
        }
      })
      this.notify = null
    }
  }

  /**
   * Schickt eine UDS-/OBD-Anfrage an ein Steuergerät und liefert dessen Antwort.
   * "Response pending" (7F xx 78) verlängert die Wartezeit.
   */
  transact(address: number, uds: number[], timeoutMs = 3000): Promise<Timed<number[]>> {
    const run = async (): Promise<Timed<number[]>> => {
      const socket = this.socket
      if (!socket) throw new LinkError('Nicht verbunden')
      this.inbox = []
      this.log('tx', `${toHex([address])}: ${toHex(uds)}`)
      const sent = performance.now()

      for (let attempt = 0; ; attempt++) {
        await socket.write(encodeDiag(address, uds))
        const ack = await this.nextFrame((f) => f.control === CTRL.ACK || f.control === CTRL.NACK, ACK_TIMEOUT_MS)
        if (!ack) throw new LinkError('Keine Bestätigung vom Gateway')
        if (ack.control === CTRL.ACK) break
        if (attempt >= 1) throw new LinkError('Gateway hat die Anfrage abgelehnt (NACK)')
      }

      let deadline = timeoutMs
      for (;;) {
        const frame = await this.nextFrame(
          (f) => f.control === CTRL.DIAG && f.payload[0] === address && f.payload[1] === TESTER_ADDRESS,
          deadline,
        )
        if (!frame) throw new LinkError(`Keine Antwort von Steuergerät ${toHex([address])}`)
        const response = frame.payload.slice(2)
        if (response[0] === 0x7f && response[2] === 0x78) {
          deadline = 10000
          continue
        }
        this.log('rx', `${toHex([address])}: ${toHex(response)}`)
        return { value: response, t: (sent + performance.now()) / 2 }
      }
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
  }

  async getSupportedPids(): Promise<Set<number>> {
    const supported = new Set<number>()
    for (let base = 0x00; base <= 0xa0; base += 0x20) {
      const res = await this.transact(DME, [0x01, base]).catch(() => null)
      if (!res) break
      supportedFromMessages([res.value], base).forEach((p) => supported.add(p))
      if (!supported.has(base + 0x20)) break
    }
    return supported
  }

  async readPid(def: PidDef) {
    return (await this.readPidTimed(def)).value
  }

  async readPidTimed(def: PidDef): Promise<Timed<number | null>> {
    const { value, t } = await this.transact(DME, [0x01, def.pid])
    const data = pidFromMessages([value], def.pid)
    return { value: data ? def.decode(data) : null, t }
  }

  async readDtcs(mode: 0x03 | 0x07 | 0x0a): Promise<string[]> {
    const codes = new Set<string>()
    for (const ecu of [DME, EGS]) {
      const res = await this.transact(ecu, [mode]).catch(() => null)
      if (res) dtcsFromMessages([res.value], mode, true).forEach((c) => codes.add(c))
    }
    return [...codes]
  }

  async clearDtcs() {
    for (const ecu of [DME, EGS]) {
      const res = await this.transact(ecu, [0x04]).catch(() => null)
      if (ecu === DME && res?.value[0] !== 0x44) throw new LinkError('Löschen fehlgeschlagen')
    }
  }

  async readVin() {
    if (this.ident?.vin) return this.ident.vin
    const res = await this.transact(DME, [0x09, 0x02]).catch(() => null)
    return res ? vinFromMessages([res.value]) : null
  }

  async readBatteryVoltage() {
    const value = await this.readPid(PID_BY_ID.get(0x42)!).catch(() => null)
    return value === null ? null : `${value.toFixed(1)}V`
  }

  async setTarget(target: EcuTarget | null) {
    if (target && !isAddressTarget(target)) throw new LinkError('ENET benötigt eine Diagnoseadresse.')
    this.target = target ? target.address : null
  }

  async request(bytes: number[], timeoutMs = 8000) {
    if (this.target === null) throw new LinkError('Kein Steuergerät gewählt')
    return (await this.transact(this.target, bytes, timeoutMs)).value
  }

  async sendRaw(command: string) {
    const bytes = command.replace(/\s/g, '').match(/../g)?.map((b) => parseInt(b, 16)) ?? []
    if (bytes.length < 2 || bytes.some(Number.isNaN)) {
      this.log('error', 'Format: Adresse und Daten als Hex, z. B. 12 22 F1 90')
      return []
    }
    const res = await this.transact(bytes[0], bytes.slice(1), 8000).catch((e: Error) => {
      this.log('error', e.message)
      return null
    })
    return res ? [toHex(res.value)] : []
  }

  async close() {
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onClose = null
      await socket.close()
    }
  }
}
