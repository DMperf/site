import type { Transport } from './transport'

const hex = (n: number, len = 2) =>
  Math.max(0, Math.round(n)).toString(16).toUpperCase().padStart(len, '0').slice(-len)

/**
 * Simuliert einen ELM327 an einem CAN-Fahrzeug (ISO 15765-4, 11 bit, 500 kbit/s),
 * damit sich die App ohne Auto und Dongle ausprobieren lässt.
 */
export class SimulatorTransport implements Transport {
  readonly kind = 'demo' as const
  readonly label = 'Demo-Fahrzeug'
  onData: ((chunk: string) => void) | null = null
  onDisconnect: (() => void) | null = null

  private start = Date.now()
  private dtcs = ['0133', '0420']
  private echo = true

  async connect() {
    this.start = Date.now()
  }

  async disconnect() {}

  async write(data: string) {
    const cmd = data.replace(/\s/g, '').toUpperCase()
    const reply = this.respond(cmd)
    const echo = this.echo ? data : ''
    window.setTimeout(() => this.onData?.(`${echo}${reply}\r\r>`), 25 + Math.random() * 40)
  }

  private respond(cmd: string): string {
    if (cmd === 'ATZ') {
      this.echo = true
      return '\r\rELM327 v1.5'
    }
    if (cmd === 'ATE0') {
      this.echo = false
      return 'OK'
    }
    if (cmd === 'ATRV') return `${(12.4 + Math.random() * 1.8).toFixed(1)}V`
    if (cmd === 'ATDP') return 'AUTO, ISO 15765-4 (CAN 11/500)'
    if (cmd === 'ATDPN') return 'A6'
    if (cmd === 'ATI') return 'ELM327 v1.5'
    if (cmd.startsWith('AT')) return 'OK'

    if (cmd === '03') {
      const body = this.dtcs.join('')
      return `43${hex(this.dtcs.length)}${body}`
    }
    if (cmd === '07') return '4700'
    if (cmd === '0A') return '4A00'
    if (cmd === '04') {
      this.dtcs = []
      return '44'
    }
    if (cmd === '0902') {
      return '014\r0: 490201575657\r1: 5A5A5A314B5A41\r2: 4D353433323130'
    }
    if (cmd.startsWith('01') && cmd.length === 4) {
      const pid = parseInt(cmd.slice(2), 16)
      const data = this.pidData(pid)
      return data === null ? 'NO DATA' : `41${hex(pid)}${data}`
    }
    return '?'
  }

  private pidData(pid: number): string | null {
    const t = (Date.now() - this.start) / 1000
    // Einfacher Fahrzyklus: Beschleunigen, Gas weg, Leerlauf.
    const phase = (Math.sin(t / 4) + 1) / 2
    const throttle = Math.max(0, Math.sin(t / 4)) * 85 + 3
    const rpm = 800 + phase * 4800 + Math.random() * 60
    const speed = Math.max(0, Math.sin(t / 12) * 70 + 60)
    const warm = Math.min(90, 20 + t * 1.5)
    const map = 35 + (throttle / 100) * 180

    switch (pid) {
      case 0x00: return 'BE3FB813'
      case 0x20: return '80022001'
      case 0x40: return '44800010'
      case 0x04: return hex((throttle / 100) * 255 * 0.9)
      case 0x05: return hex(warm + 40)
      case 0x06: return hex(128 + Math.sin(t) * 6)
      case 0x07: return hex(131)
      case 0x0b: return hex(map)
      case 0x0c: return hex(rpm * 4, 4)
      case 0x0d: return hex(speed)
      case 0x0e: return hex((12 + phase * 18 + 64) * 2)
      case 0x0f: return hex(32 + phase * 8 + 40)
      case 0x10: return hex((rpm / 6000) * 160 * 100 * (throttle / 100 + 0.1), 4)
      case 0x11: return hex((throttle / 100) * 255)
      case 0x1f: return hex(t, 4)
      case 0x2f: return hex(0.62 * 255)
      case 0x33: return hex(100)
      case 0x42: return hex(14100 + Math.random() * 200, 4)
      case 0x46: return hex(18 + 40)
      case 0x49: return hex((throttle / 100) * 255)
      case 0x5c: return hex(Math.min(105, 15 + t * 1.2) + 40)
      default: return null
    }
  }
}
