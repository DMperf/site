/**
 * Parser für ELM327-Antworten (Header aus, ATH0).
 *
 * Einzelframes kommen als "41 0C 1A F8" bzw. "410C1AF8".
 * CAN-Mehrfachframes kommen als Längen-Header plus nummerierte Zeilen:
 *   014
 *   0: 49 02 01 57 30 4C
 *   1: 30 30 30 30 34 33
 */

export const ELM_ERRORS = [
  'NO DATA',
  'UNABLE TO CONNECT',
  'CAN ERROR',
  'BUS INIT',
  'BUS ERROR',
  'BUFFER FULL',
  'DATA ERROR',
  'FB ERROR',
  'STOPPED',
  'ERR',
  '?',
]

/** Zerlegt die Rohantwort in Zeilen ohne Echo, Prompt, "SEARCHING..." und erfolgreiches "BUS INIT". */
export function splitLines(raw: string, command?: string): string[] {
  const cmd = command?.replace(/\s/g, '').toUpperCase()
  return raw
    .replace(/\0/g, '')
    .replace(/>/g, '')
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^SEARCHING/i.test(l))
    .filter((l) => !/^BUS INIT/i.test(l) || /ERROR/i.test(l))
    .filter((l) => !cmd || l.replace(/\s/g, '').toUpperCase() !== cmd)
}

export function findError(lines: string[]): string | null {
  for (const line of lines) {
    const upper = line.toUpperCase()
    const hit = ELM_ERRORS.find((e) => upper.startsWith(e))
    if (hit) return line
  }
  return null
}

const hexBytes = (hex: string): number[] => {
  const out: number[] = []
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
  return out
}

/** Fasst Zeilen zu vollständigen Nachrichten (Byte-Arrays) zusammen. */
export function parseMessages(lines: string[]): number[][] {
  const messages: number[][] = []
  let multi: { length: number; bytes: number[] } | null = null

  const flush = () => {
    if (multi) messages.push(multi.bytes.slice(0, multi.length))
    multi = null
  }

  for (const line of lines) {
    const compact = line.replace(/\s/g, '').toUpperCase()
    if (!/^[0-9A-F:]+$/.test(compact)) continue

    if (/^[0-9A-F]{3}$/.test(compact)) {
      flush()
      multi = { length: parseInt(compact, 16), bytes: [] }
    } else if (/^[0-9A-F]:/.test(compact) && multi) {
      ;(multi as { bytes: number[] }).bytes.push(...hexBytes(compact.slice(2)))
    } else {
      flush()
      messages.push(hexBytes(compact))
    }
  }
  flush()
  return messages
}

/** Liefert die Datenbytes einer Mode-01-Antwort für die gegebene PID. */
export function parsePidResponse(lines: string[], pid: number): number[] | null {
  return pidFromMessages(parseMessages(lines), pid)
}

export function pidFromMessages(messages: number[][], pid: number): number[] | null {
  for (const msg of messages) {
    if (msg[0] === 0x41 && msg[1] === pid) return msg.slice(2)
  }
  return null
}

/** Wertet die Bitmasken aus 0100 / 0120 / 0140 … aus. */
export function parseSupportedPids(lines: string[], base: number): number[] {
  return supportedFromMessages(parseMessages(lines), base)
}

export function supportedFromMessages(messages: number[][], base: number): number[] {
  const supported = new Set<number>()
  for (const msg of messages) {
    if (msg[0] !== 0x41 || msg[1] !== base) continue
    const mask = msg.slice(2, 6)
    mask.forEach((byte, i) => {
      for (let bit = 0; bit < 8; bit++) {
        if (byte & (0x80 >> bit)) supported.add(base + i * 8 + bit + 1)
      }
    })
  }
  return [...supported]
}

export function decodeDtc(a: number, b: number): string {
  const letter = 'PCBU'[a >> 6]
  const hex = (n: number) => n.toString(16).toUpperCase()
  return `${letter}${(a >> 4) & 0x3}${hex(a & 0xf)}${hex(b >> 4)}${hex(b & 0xf)}`
}

/**
 * Fehlercodes aus Mode 03/07/0A. Bei CAN folgt nach dem Service-Byte ein
 * Zählerbyte, bei älteren Protokollen (K-Line, J1850) nicht.
 */
export function parseDtcResponse(lines: string[], mode: number, isCan: boolean): string[] {
  return dtcsFromMessages(parseMessages(lines), mode, isCan)
}

export function dtcsFromMessages(messages: number[][], mode: number, isCan: boolean): string[] {
  const codes = new Set<string>()
  for (const msg of messages) {
    if (msg[0] !== mode + 0x40) continue
    let data = msg.slice(1)
    if (isCan) {
      const count = data[0] ?? 0
      data = data.slice(1, 1 + count * 2)
    }
    for (let i = 0; i + 1 < data.length; i += 2) {
      if (data[i] === 0 && data[i + 1] === 0) continue
      codes.add(decodeDtc(data[i], data[i + 1]))
    }
  }
  return [...codes]
}

/** Fahrgestellnummer aus Mode 09 PID 02. */
export function parseVin(lines: string[]): string | null {
  return vinFromMessages(parseMessages(lines))
}

export function vinFromMessages(messages: number[][]): string | null {
  const bytes = messages.flat()
  // VIN-Zeichensatz enthält kein I, O, Q – damit fallen Service-Byte 0x49
  // und Zähler/Padding automatisch heraus.
  const chars = bytes
    .map((b) => String.fromCharCode(b))
    .filter((c) => /[A-HJ-NPR-Z0-9]/.test(c))
    .join('')
  return chars.length >= 17 ? chars.slice(-17) : null
}
