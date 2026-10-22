import { SimVehicle, type SimEcu } from '../sim/vehicle'
import type { Transport } from './transport'

/** Anfrage-IDs der Demo-Steuergeräte (VAG-Adressen für Kombi und Zentralelektrik). */
const ECUS: Record<string, SimEcu> = { '7E0': 'engine', '7E1': 'gearbox', '714': 'kombi', '70E': 'body' }

const hex = (n: number, len = 2) => n.toString(16).toUpperCase().padStart(len, '0')
const bytesHex = (bytes: number[]) => bytes.map((b) => hex(b)).join('')

/** Formatiert eine Antwort wie ein ELM327 mit ATH0/ATS0 (inkl. ISO-TP-Mehrfachframes). */
function frame(bytes: number[]): string {
  if (bytes.length <= 7) return bytesHex(bytes)
  const lines = [hex(bytes.length, 3)]
  lines.push(`0: ${bytesHex(bytes.slice(0, 6))}`)
  for (let i = 6, n = 1; i < bytes.length; i += 7, n++) {
    lines.push(`${(n % 16).toString(16).toUpperCase()}: ${bytesHex(bytes.slice(i, i + 7))}`)
  }
  return lines.join('\r')
}

/**
 * Simuliert einen ELM327 an einem CAN-Fahrzeug (ISO 15765-4, 11 bit, 500 kbit/s),
 * damit sich die App ohne Auto und Dongle ausprobieren lässt.
 */
export class SimulatorTransport implements Transport {
  readonly kind = 'demo' as const
  readonly label = 'Demo-Fahrzeug'
  onData: ((chunk: string) => void) | null = null
  onDisconnect: (() => void) | null = null

  private vehicle = new SimVehicle()
  private echo = true
  private header = '7DF'

  async connect() {}

  async disconnect() {}

  async write(data: string) {
    const cmd = data.replace(/\s/g, '').toUpperCase()
    const reply = this.respond(cmd)
    const echo = this.echo ? data : ''
    window.setTimeout(() => this.onData?.(`${echo}${reply}\r\r>`), 25 + Math.random() * 25)
  }

  private respond(cmd: string): string {
    if (cmd === 'ATZ') {
      this.echo = true
      this.header = '7DF'
      return '\r\rELM327 v1.5'
    }
    if (cmd === 'ATE0') {
      this.echo = false
      return 'OK'
    }
    if (cmd.startsWith('ATSH')) {
      this.header = cmd.slice(4)
      return 'OK'
    }
    if (cmd === 'ATRV') return `${(12.4 + Math.random() * 1.8).toFixed(1)}V`
    if (cmd === 'ATDP') return 'AUTO, ISO 15765-4 (CAN 11/500)'
    if (cmd === 'ATDPN') return 'A6'
    if (cmd === 'ATI') return 'ELM327 v1.5'
    if (cmd.startsWith('AT')) return 'OK'
    if (!/^[0-9A-F]+$/.test(cmd)) return '?'

    // "010C1": angehängte Antwortanzahl ignorieren
    const hexCmd = cmd.length === 5 && cmd.startsWith('01') ? cmd.slice(0, 4) : cmd
    const req = hexCmd.match(/../g)!.map((b) => parseInt(b, 16))

    if (this.header === '7DF') {
      const res = this.vehicle.obd(req)
      return res ? frame(res) : 'NO DATA'
    }
    const ecu = ECUS[this.header]
    return ecu ? frame(this.vehicle.uds(ecu, req)) : 'NO DATA'
  }
}
