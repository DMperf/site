import type { Transport } from './transport'

const hex = (n: number, len = 2) =>
  Math.max(0, Math.round(n)).toString(16).toUpperCase().padStart(len, '0').slice(-len)

const bytesHex = (bytes: number[]) => bytes.map((b) => hex(b)).join('')
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

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

// Demo-Fahrzeug: 2,0-l-Turbobenziner, ca. 205 PS, 1500 kg, 5 Gänge.
const MASS = 1500
const WHEEL_RADIUS = 0.32
const FINAL_DRIVE = 3.7
const GEARS = [3.5, 2.1, 1.45, 1.1, 0.9]
const DRIVETRAIN_EFFICIENCY = 0.85
const SHIFT_RPM = 6500
const SHIFT_TIME = 0.3
const IDLE = 800

function engineTorque(rpm: number) {
  if (rpm < 1500) return 200 + (rpm - 1000) * 0.24
  if (rpm < 4500) return 320
  return Math.max(0, 320 - (rpm - 4500) * 0.06)
}

type Phase = 'stop' | 'accel' | 'brake'

/**
 * Simuliert einen ELM327 an einem CAN-Fahrzeug (ISO 15765-4, 11 bit, 500 kbit/s),
 * damit sich die App ohne Auto und Dongle ausprobieren lässt. Das Fahrzeug fährt
 * in Schleife: Stillstand → Vollgasbeschleunigung bis 180 km/h → Bremsen.
 */
export class SimulatorTransport implements Transport {
  readonly kind = 'demo' as const
  readonly label = 'Demo-Fahrzeug'
  onData: ((chunk: string) => void) | null = null
  onDisconnect: (() => void) | null = null

  private start = performance.now()
  private last = performance.now()
  private dtcs = ['0133', '0420']
  private echo = true
  private header = '7DF'
  private session = 1
  private coding = [0x01, 0x14, 0x03, 0x0a, 0x24, 0x00, 0x80, 0x00, 0x00, 0x10]
  private udsDtcs: number[][] = [
    [0x04, 0x20, 0x00, 0x09],
    [0xc1, 0x00, 0x87, 0x08],
  ]

  // Fahrzustand
  private phase: Phase = 'stop'
  private phaseTime = 0
  private v = 0
  private gear = 0
  private shiftLeft = 0
  private rpm = IDLE

  async connect() {
    this.start = this.last = performance.now()
  }

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
      this.session = 1
      return 'OK'
    }
    if (cmd === 'ATRV') return `${(12.4 + Math.random() * 1.8).toFixed(1)}V`
    if (cmd === 'ATDP') return 'AUTO, ISO 15765-4 (CAN 11/500)'
    if (cmd === 'ATDPN') return 'A6'
    if (cmd === 'ATI') return 'ELM327 v1.5'
    if (cmd.startsWith('AT')) return 'OK'

    if (this.header !== '7DF') return this.respondUds(cmd)

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
    if (cmd === '0902') return frame([0x49, 0x02, 0x01, ...ascii('WVWZZZ1KZAM543210')])
    // "010C" oder Schnellabfrage "010C1"
    if (cmd.startsWith('01') && (cmd.length === 4 || cmd.length === 5)) {
      const pid = parseInt(cmd.slice(2, 4), 16)
      const data = this.pidData(pid)
      return data === null ? 'NO DATA' : `41${hex(pid)}${data}`
    }
    return '?'
  }

  private respondUds(cmd: string): string {
    const ecu = this.header
    if (ecu !== '7E0' && ecu !== '7E1') return 'NO DATA'
    const req = cmd.match(/../g)?.map((b) => parseInt(b, 16)) ?? []
    const [sid] = req
    const neg = (nrc: number) => bytesHex([0x7f, sid, nrc])

    switch (sid) {
      case 0x10:
        this.session = req[1]
        return bytesHex([0x50, req[1], 0x00, 0x32, 0x01, 0xf4])
      case 0x3e:
        return '7E00'
      case 0x22: {
        const did = (req[1] << 8) | req[2]
        const value = this.didValue(ecu, did)
        return value ? frame([0x62, req[1], req[2], ...value]) : neg(0x31)
      }
      case 0x2e: {
        const did = (req[1] << 8) | req[2]
        if (ecu !== '7E0' || did !== 0x0600) return neg(0x33)
        if (this.session !== 3) return neg(0x7f)
        this.coding = req.slice(3)
        return bytesHex([0x6e, req[1], req[2]])
      }
      case 0x19:
        if (ecu !== '7E0') return frame([0x59, 0x02, 0xff])
        return frame([0x59, 0x02, 0xff, ...this.udsDtcs.flat()])
      case 0x14:
        this.udsDtcs = []
        return '54'
      default:
        return neg(0x11)
    }
  }

  private didValue(ecu: string, did: number): number[] | null {
    const engine: Record<number, number[]> = {
      0xf187: ascii('06K907425B  '),
      0xf189: ascii('0003'),
      0xf191: ascii('06K907425   '),
      0xf18c: ascii('VWZ7Z0J1234567'),
      0xf197: ascii('R4 2.0l TFSI'),
      0xf190: ascii('WVWZZZ1KZAM543210'),
      0x0600: this.coding,
    }
    const gearbox: Record<number, number[]> = {
      0xf187: ascii('0GC927711   '),
      0xf189: ascii('2105'),
      0xf197: ascii('DQ381'),
    }
    return (ecu === '7E0' ? engine : gearbox)[did] ?? null
  }

  /** Integriert die Fahrdynamik bis zum aktuellen Zeitpunkt. */
  private simulate() {
    const now = performance.now()
    let dt = Math.min(1, (now - this.last) / 1000)
    this.last = now
    const step = 0.005
    while (dt > 0) {
      const h = Math.min(step, dt)
      dt -= h
      this.phaseTime += h
      const ratio = GEARS[this.gear] * FINAL_DRIVE
      const wheelRpm = (this.v / WHEEL_RADIUS) * (60 / (2 * Math.PI))

      if (this.phase === 'stop') {
        this.v = 0
        this.gear = 0
        this.rpm = IDLE
        if (this.phaseTime > 4) this.setPhase('accel')
        continue
      }

      if (this.phase === 'accel') {
        const coupled = wheelRpm * ratio
        // Kupplung schleift beim Anfahren bei 2500 U/min.
        this.rpm = this.shiftLeft > 0 ? this.rpm : Math.max(coupled, 2500)
        let force = 0
        if (this.shiftLeft > 0) {
          this.shiftLeft -= h
          if (this.shiftLeft <= 0) this.rpm = coupled
        } else {
          force = (engineTorque(this.rpm) * ratio * DRIVETRAIN_EFFICIENCY) / WHEEL_RADIUS
          if (coupled >= SHIFT_RPM && this.gear < GEARS.length - 1) {
            this.gear++
            this.shiftLeft = SHIFT_TIME
          }
        }
        const drag = 0.5 * 1.2 * 0.3 * 2.2 * this.v ** 2 + MASS * 9.81 * 0.012
        this.v += ((force - drag) / (MASS * 1.05)) * h
        if (this.v * 3.6 >= 180) this.setPhase('brake')
        continue
      }

      // Bremsen
      this.v = Math.max(0, this.v - 6 * h)
      while (this.gear > 0 && wheelRpm * GEARS[this.gear] * FINAL_DRIVE < 1500) this.gear--
      this.rpm = Math.max(IDLE, wheelRpm * GEARS[this.gear] * FINAL_DRIVE)
      if (this.v === 0) this.setPhase('stop')
    }
  }

  private setPhase(phase: Phase) {
    this.phase = phase
    this.phaseTime = 0
    this.shiftLeft = 0
  }

  private pidData(pid: number): string | null {
    this.simulate()
    const t = (performance.now() - this.start) / 1000
    const wot = this.phase === 'accel' && this.shiftLeft <= 0
    const throttle = wot ? 100 : this.phase === 'stop' ? 0 : 2
    const map = wot ? Math.min(205, 100 + (this.rpm - 1500) * 0.04) : 32
    const warm = Math.min(90, 20 + t * 1.5)

    switch (pid) {
      case 0x00: return 'BE3FB813'
      case 0x20: return '80022001'
      case 0x40: return '44800010'
      case 0x04: return hex(wot ? 240 : 40)
      case 0x05: return hex(warm + 40)
      case 0x06: return hex(128 + Math.sin(t) * 6)
      case 0x07: return hex(131)
      case 0x0b: return hex(map)
      case 0x0c: return hex(this.rpm * 4, 4)
      case 0x0d: return hex(this.v * 3.6)
      case 0x0e: return hex(((wot ? 8 : 25) + 64) * 2)
      case 0x0f: return hex(30 + 40)
      case 0x10: return hex((this.rpm / 60) * (map / 100) * 0.9 * 100, 4)
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
