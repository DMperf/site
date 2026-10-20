import { decodeDtc } from './parse'
import type { CanTarget, Elm327 } from './elm327'

/** Negative Response Codes nach ISO 14229-1. */
const NRC: Record<number, string> = {
  0x10: 'Allgemeine Ablehnung',
  0x11: 'Dienst nicht unterstützt',
  0x12: 'Unterfunktion nicht unterstützt',
  0x13: 'Falsche Nachrichtenlänge oder ungültiges Format',
  0x14: 'Antwort zu lang',
  0x21: 'Beschäftigt – Anfrage wiederholen',
  0x22: 'Bedingungen nicht erfüllt (z. B. Motor läuft, falsche Sitzung)',
  0x24: 'Falsche Reihenfolge der Anfragen',
  0x31: 'Wert außerhalb des zulässigen Bereichs / Datenkennung unbekannt',
  0x33: 'Security Access erforderlich',
  0x35: 'Ungültiger Schlüssel',
  0x36: 'Zu viele Versuche',
  0x37: 'Sperrzeit noch nicht abgelaufen',
  0x72: 'Allgemeiner Programmierfehler',
  0x7e: 'Unterfunktion in aktueller Sitzung nicht unterstützt',
  0x7f: 'Dienst in aktueller Sitzung nicht unterstützt',
}

export class UdsError extends Error {
  code: number
  constructor(sid: number, code: number) {
    const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
    super(`${NRC[code] ?? 'Unbekannte Ablehnung'} (NRC ${hex(code)} auf Dienst ${hex(sid)})`)
    this.code = code
  }
}

export interface EcuPreset {
  name: string
  target: CanTarget
}

export const ECU_PRESETS: { group: string; ecus: EcuPreset[] }[] = [
  {
    group: 'OBD-Standard (alle Hersteller)',
    ecus: [
      { name: 'Motor (7E0)', target: { tx: 0x7e0, rx: 0x7e8 } },
      { name: 'Getriebe (7E1)', target: { tx: 0x7e1, rx: 0x7e9 } },
      { name: 'Steuergerät 7E2', target: { tx: 0x7e2, rx: 0x7ea } },
      { name: 'Steuergerät 7E3', target: { tx: 0x7e3, rx: 0x7eb } },
    ],
  },
  {
    // Übliche Adressen bei VW/Audi/Seat/Skoda (UDS-Plattformen wie MQB);
    // je nach Modell können sie abweichen.
    group: 'VAG (VW, Audi, Seat, Skoda)',
    ecus: [
      { name: '01 Motorelektronik', target: { tx: 0x7e0, rx: 0x7e8 } },
      { name: '02 Getriebe', target: { tx: 0x7e1, rx: 0x7e9 } },
      { name: '03 Bremsenelektronik', target: { tx: 0x713, rx: 0x77d } },
      { name: '09 Zentralelektrik', target: { tx: 0x70e, rx: 0x778 } },
      { name: '17 Schalttafeleinsatz', target: { tx: 0x714, rx: 0x77e } },
      { name: '19 Gateway', target: { tx: 0x710, rx: 0x77a } },
    ],
  },
]

export interface DidPreset {
  did: number
  name: string
  ascii: boolean
}

export const IDENT_DIDS: DidPreset[] = [
  { did: 0xf187, name: 'Ersatzteilnummer', ascii: true },
  { did: 0xf189, name: 'Softwareversion', ascii: true },
  { did: 0xf191, name: 'Hardwarenummer', ascii: true },
  { did: 0xf18c, name: 'Seriennummer', ascii: true },
  { did: 0xf197, name: 'Systembezeichnung', ascii: true },
  { did: 0xf190, name: 'Fahrgestellnummer', ascii: true },
]

export const CODING_DIDS: DidPreset[] = [
  { did: 0x0600, name: 'Codierung (VAG)', ascii: false },
  { did: 0xf190, name: 'Fahrgestellnummer', ascii: true },
]

export interface EcuDtc {
  code: string
  status: number
}

export const toHex = (bytes: number[]) =>
  bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

export const toAscii = (bytes: number[]) =>
  bytes
    .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ''))
    .join('')
    .trim()

export function parseHex(input: string): number[] | null {
  const clean = input.replace(/\s/g, '')
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null
  const out: number[] = []
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16))
  return out
}

/** Unified Diagnostic Services (ISO 14229) über einen ELM327. */
export class Uds {
  private elm: Elm327
  constructor(elm: Elm327) {
    this.elm = elm
  }

  /** Schickt einen Dienst und liefert die Nutzdaten der positiven Antwort. */
  async call(sid: number, data: number[] = []): Promise<number[]> {
    const response = await this.elm.request([sid, ...data])
    if (response[0] === 0x7f) throw new UdsError(sid, response[2] ?? 0)
    if (response[0] !== sid + 0x40) throw new Error(`Unerwartete Antwort: ${toHex(response)}`)
    return response.slice(1)
  }

  session(type: 0x01 | 0x03) {
    return this.call(0x10, [type])
  }

  testerPresent() {
    return this.call(0x3e, [0x00])
  }

  async readDid(did: number): Promise<number[]> {
    const data = await this.call(0x22, [did >> 8, did & 0xff])
    return data.slice(2)
  }

  async writeDid(did: number, value: number[]): Promise<void> {
    await this.call(0x2e, [did >> 8, did & 0xff, ...value])
  }

  /** Fehlerspeicher des Steuergeräts (19 02, alle Statusbits). */
  async readDtcs(): Promise<EcuDtc[]> {
    const data = await this.call(0x19, [0x02, 0xff])
    const records = data.slice(2)
    const out: EcuDtc[] = []
    for (let i = 0; i + 3 < records.length; i += 4) {
      const [a, b, type, status] = records.slice(i, i + 4)
      if (status === 0) continue
      const ft = type.toString(16).toUpperCase().padStart(2, '0')
      out.push({ code: `${decodeDtc(a, b)}-${ft}`, status })
    }
    return out
  }

  async clearDtcs() {
    await this.call(0x14, [0xff, 0xff, 0xff])
  }
}

/** Lesbare Bedeutung der DTC-Statusbits (ISO 14229 Anhang D). */
export function describeStatus(status: number): string {
  const parts: string[] = []
  if (status & 0x01) parts.push('aktiv')
  if (status & 0x08) parts.push('bestätigt')
  if (status & 0x04) parts.push('ausstehend')
  if (status & 0x80) parts.push('Warnleuchte')
  if (!(status & 0x01) && status & 0x08) parts.push('derzeit nicht vorhanden')
  return parts.join(', ') || 'gespeichert'
}
