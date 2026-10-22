import type { ByteSocket, Network, UdpReply } from '../net/socket'
import {
  CTRL,
  encodeFrame,
  FrameReader,
  HSFZ_DIAG_PORT,
  HSFZ_IDENT_PORT,
  OBD_FUNCTIONAL_ADDRESS,
  TESTER_ADDRESS,
} from '../obd/hsfz'
import { SimVehicle, type SimEcu } from './vehicle'

const DEMO_IP = '169.254.12.34'
const DEMO_VIN = 'WBA8E9C50GK123456'
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

const ECUS: Record<number, SimEcu> = { 0x12: 'engine', 0x18: 'gearbox' }

/**
 * Simuliertes BMW-Fahrzeug am ENET-Kabel: ZGW mit HSFZ-Protokoll,
 * Motor- (0x12) und Getriebesteuergerät (0x18).
 */
export class SimulatedEnetNetwork implements Network {
  private vehicle = new SimVehicle(DEMO_VIN, {
    part: '8631584',
    software: '0A1B',
    hardware: '8631584',
    serial: 'BMW0000123456',
    name: 'DME B48 (Demo)',
  })

  async udpRequest(host: string, port: number, payload: Uint8Array): Promise<UdpReply[]> {
    const isIdent = port === HSFZ_IDENT_PORT && payload[5] === CTRL.IDENT
    if (!isIdent || (host !== DEMO_IP && host !== '255.255.255.255')) return []
    const body = ascii(`DIAGADR10BMWMAC001A37C0FFEEBMWVIN${DEMO_VIN}`)
    await new Promise((r) => setTimeout(r, 120))
    return [{ address: DEMO_IP, data: encodeFrame(CTRL.IDENT, body) }]
  }

  async connectTcp(host: string, port: number): Promise<ByteSocket> {
    await new Promise((r) => setTimeout(r, 80))
    if (host !== DEMO_IP || port !== HSFZ_DIAG_PORT) {
      throw new Error(`Verbindung zu ${host}:${port} fehlgeschlagen`)
    }
    return new SimGatewaySocket(this.vehicle)
  }
}

class SimGatewaySocket implements ByteSocket {
  onData: ((bytes: Uint8Array) => void) | null = null
  onClose: ((error?: string) => void) | null = null
  private reader = new FrameReader()
  private vehicle: SimVehicle

  constructor(vehicle: SimVehicle) {
    this.vehicle = vehicle
  }

  async write(bytes: Uint8Array) {
    for (const frame of this.reader.push(bytes)) {
      if (frame.control !== CTRL.DIAG) continue
      const [source, target, ...uds] = frame.payload
      // ACK = Echo der Anfrage
      this.emit(encodeFrame(CTRL.ACK, frame.payload), 5)

      let response: number[] | null = null
      if (target === OBD_FUNCTIONAL_ADDRESS) response = this.vehicle.obd(uds)
      else if (ECUS[target]) response = this.vehicle.uds(ECUS[target], uds)
      if (!response) continue
      // Antwort in zwei Teilen schicken, um zerteilte TCP-Pakete zu testen.
      const reply = encodeFrame(CTRL.DIAG, [target, source ?? TESTER_ADDRESS, ...response])
      const delay = 15 + Math.random() * 20
      this.emit(reply.slice(0, 4), delay)
      this.emit(reply.slice(4), delay + 1)
    }
  }

  private emit(bytes: Uint8Array, delayMs: number) {
    setTimeout(() => this.onData?.(bytes), delayMs)
  }

  async close() {}
}

export const SIM_ENET_IP = DEMO_IP
