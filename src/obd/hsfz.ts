/**
 * BMW HSFZ (High Speed Fahrzeugzugang) – Diagnose über ENET.
 *
 * Rahmen: [Länge u32 BE][Steuerwort u16 BE][Nutzdaten …], Länge = Nutzdaten.
 * Diagnose-Nutzdaten: [Quelladresse][Zieladresse][UDS …].
 * Der Gateway (ZGW) bestätigt jede Anfrage mit einem ACK (Steuerwort 0x02,
 * Echo der Anfrage), danach folgt die Antwort des Steuergeräts.
 * Fahrzeugerkennung per UDP-Broadcast an Port 6811.
 */

export const HSFZ_DIAG_PORT = 6801
export const HSFZ_IDENT_PORT = 6811
export const TESTER_ADDRESS = 0xf4
/** Funktionale Adresse für OBD-Anfragen an alle abgasrelevanten Steuergeräte. */
export const OBD_FUNCTIONAL_ADDRESS = 0xdf

export const CTRL = {
  DIAG: 0x0001,
  ACK: 0x0002,
  IDENT: 0x0011,
  ALIVE_CHECK: 0x0012,
  ALIVE_RESPONSE: 0x0013,
  NACK: 0x00ff,
} as const

export interface HsfzFrame {
  control: number
  payload: number[]
}

export function encodeFrame(control: number, payload: number[]): Uint8Array {
  const len = payload.length
  return new Uint8Array([
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
    (control >> 8) & 0xff,
    control & 0xff,
    ...payload,
  ])
}

export const encodeDiag = (target: number, uds: number[], source = TESTER_ADDRESS) =>
  encodeFrame(CTRL.DIAG, [source, target, ...uds])

/** Setzt Rahmen aus einem TCP-Datenstrom zusammen (Rahmen können zerteilt ankommen). */
export class FrameReader {
  private buffer: number[] = []

  push(bytes: Uint8Array): HsfzFrame[] {
    this.buffer.push(...bytes)
    const frames: HsfzFrame[] = []
    while (this.buffer.length >= 6) {
      const b = this.buffer
      const len = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
      if (len > 0x10000) {
        // Unsinnige Länge – Strom verloren, neu synchronisieren.
        this.buffer = []
        break
      }
      if (b.length < 6 + len) break
      frames.push({ control: (b[4] << 8) | b[5], payload: b.slice(6, 6 + len) })
      this.buffer = b.slice(6 + len)
    }
    return frames
  }
}

export const IDENT_REQUEST = encodeFrame(CTRL.IDENT, [])

export interface VehicleIdent {
  address: string
  vin: string | null
  mac: string | null
}

/** Antwort auf die Fahrzeugerkennung: "DIAGADR10BMWMAC<12>BMWVIN<17>". */
export function parseIdent(address: string, data: Uint8Array): VehicleIdent | null {
  const text = String.fromCharCode(...data.slice(6))
  if (!text.startsWith('DIAGADR')) return null
  const mac = text.match(/BMWMAC([0-9A-F]{12})/i)?.[1] ?? null
  const vin = text.match(/BMWVIN([A-HJ-NPR-Z0-9]{17})/)?.[1] ?? null
  return { address, vin, mac }
}
