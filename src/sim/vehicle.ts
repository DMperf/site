const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
const word = (n: number) => {
  const v = Math.max(0, Math.min(0xffff, Math.round(n)))
  return [v >> 8, v & 0xff]
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

/** Kennungen der Motorsteuerung im Demo-Fahrzeug (Teilenummer, SW, HW, Serie, Name). */
export interface SimEngineIdent {
  part: string
  software: string
  hardware: string
  serial: string
  name: string
}

const VW_ENGINE: SimEngineIdent = {
  part: '06K907425B  ',
  software: '0003',
  hardware: '06K907425   ',
  serial: 'VWZ7Z0J1234567',
  name: 'R4 2.0l TFSI',
}

export const SIM_VIN = 'WVWZZZ1KZAM543210'

function engineTorque(rpm: number) {
  if (rpm < 1500) return 200 + (rpm - 1000) * 0.24
  if (rpm < 4500) return 320
  return Math.max(0, 320 - (rpm - 4500) * 0.06)
}

type Phase = 'stop' | 'accel' | 'brake'
export type SimEcu = 'engine' | 'gearbox' | 'kombi' | 'body'

/**
 * Codierblöcke der Demo-Steuergeräte. Kombi und Karosserie haben je einen
 * BMW-artigen Block (0x3000, ENET-Demo) und einen VAG-artigen (0x0600, ELM-Demo)
 * mit gleichem Aufbau – siehe src/coding/demoDefinitions.ts.
 */
const KOMBI_CODING = [0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
const BODY_CODING = [0x00, 0x03, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00]

/**
 * Simuliertes Fahrzeug für den Demo-Modus. Fährt in Schleife:
 * Stillstand → Vollgasbeschleunigung bis 180 km/h → Bremsen.
 * Beantwortet OBD-Anfragen (Mode 01/03/04/07/09/0A) und UDS-Anfragen
 * von Motor- und Getriebesteuergerät. Alles auf Byte-Ebene.
 */
export class SimVehicle {
  readonly vin: string
  private start = performance.now()
  private last = performance.now()
  private dtcs = [
    [0x01, 0x33],
    [0x04, 0x20],
  ]
  private sessions: Record<SimEcu, number> = { engine: 1, gearbox: 1, kombi: 1, body: 1 }
  private coding: Record<SimEcu, Record<number, number[]>> = {
    engine: { 0x0600: [0x01, 0x14, 0x03, 0x0a, 0x24, 0x00, 0x80, 0x00, 0x00, 0x10] },
    gearbox: {},
    kombi: { 0x3000: [...KOMBI_CODING], 0x0600: [...KOMBI_CODING] },
    body: { 0x3000: [...BODY_CODING], 0x0600: [...BODY_CODING] },
  }
  private udsDtcs: number[][] = [
    [0x04, 0x20, 0x00, 0x09],
    [0xc1, 0x00, 0x87, 0x08],
  ]

  private phase: Phase = 'stop'
  private phaseTime = 0
  private v = 0
  private gear = 0
  private shiftLeft = 0
  private rpm = IDLE

  private engineIdent: SimEngineIdent

  constructor(vin = SIM_VIN, engineIdent = VW_ENGINE) {
    this.vin = vin
    this.engineIdent = engineIdent
  }

  /** OBD-Anfrage (Service 01–0A). `null` = keine Antwort. */
  obd(req: number[]): number[] | null {
    const [sid, pid] = req
    switch (sid) {
      case 0x01: {
        const data = this.pidData(pid)
        return data && [0x41, pid, ...data]
      }
      case 0x03:
        return [0x43, this.dtcs.length, ...this.dtcs.flat()]
      case 0x07:
        return [0x47, 0x00]
      case 0x0a:
        return [0x4a, 0x00]
      case 0x04:
        this.dtcs = []
        return [0x44]
      case 0x09:
        return pid === 0x02 ? [0x49, 0x02, 0x01, ...ascii(this.vin)] : null
      default:
        return null
    }
  }

  /** UDS-Anfrage an ein Steuergerät. */
  uds(ecu: SimEcu, req: number[]): number[] {
    const [sid] = req
    const neg = (nrc: number) => [0x7f, sid, nrc]
    if (sid >= 0x01 && sid <= 0x0a) return this.obd(req) ?? neg(0x12)

    switch (sid) {
      case 0x10:
        this.sessions[ecu] = req[1]
        return [0x50, req[1], 0x00, 0x32, 0x01, 0xf4]
      case 0x3e:
        return [0x7e, 0x00]
      case 0x22: {
        const did = (req[1] << 8) | req[2]
        const value = this.didValue(ecu, did)
        return value ? [0x62, req[1], req[2], ...value] : neg(0x31)
      }
      case 0x2e: {
        const did = (req[1] << 8) | req[2]
        const block = this.coding[ecu][did]
        if (!block) return neg(0x33)
        if (this.sessions[ecu] !== 3) return neg(0x7f)
        if (req.length - 3 !== block.length) return neg(0x13)
        this.coding[ecu][did] = req.slice(3)
        return [0x6e, req[1], req[2]]
      }
      case 0x19:
        return ecu === 'engine' ? [0x59, 0x02, 0xff, ...this.udsDtcs.flat()] : [0x59, 0x02, 0xff]
      case 0x14:
        if (ecu === 'engine') this.udsDtcs = []
        return [0x54]
      default:
        return neg(0x11)
    }
  }

  private didValue(ecu: SimEcu, did: number): number[] | null {
    if (this.coding[ecu][did]) return this.coding[ecu][did]
    const engine: Record<number, number[]> = {
      0xf187: ascii(this.engineIdent.part),
      0xf189: ascii(this.engineIdent.software),
      0xf191: ascii(this.engineIdent.hardware),
      0xf18c: ascii(this.engineIdent.serial),
      0xf197: ascii(this.engineIdent.name),
      0xf190: ascii(this.vin),
    }
    const others: Record<Exclude<SimEcu, 'engine'>, Record<number, number[]>> = {
      gearbox: { 0xf187: ascii('0GC927711   '), 0xf189: ascii('2105'), 0xf197: ascii('DQ381') },
      kombi: { 0xf187: ascii('9325012'), 0xf189: ascii('0104'), 0xf197: ascii('KOMBI (Demo)') },
      body: { 0xf187: ascii('9393713'), 0xf189: ascii('0211'), 0xf197: ascii('FEM/BDC (Demo)') },
    }
    return (ecu === 'engine' ? engine : others[ecu])[did] ?? null
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

  private pidData(pid: number): number[] | null {
    this.simulate()
    const t = (performance.now() - this.start) / 1000
    const wot = this.phase === 'accel' && this.shiftLeft <= 0
    const throttle = wot ? 100 : this.phase === 'stop' ? 0 : 2
    const map = wot ? Math.min(205, 100 + (this.rpm - 1500) * 0.04) : 32
    const warm = Math.min(90, 20 + t * 1.5)

    switch (pid) {
      case 0x00: return [0xbe, 0x3f, 0xb8, 0x13]
      case 0x20: return [0x80, 0x02, 0x20, 0x01]
      case 0x40: return [0x44, 0x80, 0x00, 0x10]
      case 0x04: return [wot ? 240 : 40]
      case 0x05: return [clampByte(warm + 40)]
      case 0x06: return [clampByte(128 + Math.sin(t) * 6)]
      case 0x07: return [131]
      case 0x0b: return [clampByte(map)]
      case 0x0c: return word(this.rpm * 4)
      case 0x0d: return [clampByte(this.v * 3.6)]
      case 0x0e: return [clampByte(((wot ? 8 : 25) + 64) * 2)]
      case 0x0f: return [70]
      case 0x10: return word((this.rpm / 60) * (map / 100) * 0.9 * 100)
      case 0x11: return [clampByte((throttle / 100) * 255)]
      case 0x1f: return word(t)
      case 0x2f: return [clampByte(0.62 * 255)]
      case 0x33: return [100]
      case 0x42: return word(14100 + Math.random() * 200)
      case 0x46: return [58]
      case 0x49: return [clampByte((throttle / 100) * 255)]
      case 0x5c: return [clampByte(Math.min(105, 15 + t * 1.2) + 40)]
      default: return null
    }
  }
}
