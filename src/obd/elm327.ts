import type { Transport } from './transport'
import {
  findError,
  parseDtcResponse,
  parsePidResponse,
  parseSupportedPids,
  parseVin,
  splitLines,
} from './parse'
import type { PidDef } from './pids'

export type LogDirection = 'tx' | 'rx' | 'info' | 'error'
export type Logger = (direction: LogDirection, text: string) => void

export interface AdapterInfo {
  version: string
  protocol: string
  protocolNumber: string
  isCan: boolean
}

export class ElmError extends Error {}

const CAN_PROTOCOLS = /^A?[6-9A-C]$/

/** Spricht mit einem ELM327 (oder kompatiblem Chip) über einen Transport. */
export class Elm327 {
  private buffer = ''
  private pending: { resolve: (raw: string) => void; reject: (e: Error) => void; timer: number } | null = null
  private queue: Promise<unknown> = Promise.resolve()
  isCan = false
  private transport: Transport
  private log: Logger

  constructor(transport: Transport, log: Logger = () => {}) {
    this.transport = transport
    this.log = log
    transport.onData = this.handleData
  }

  private handleData = (chunk: string) => {
    this.buffer += chunk
    const prompt = this.buffer.indexOf('>')
    if (prompt === -1 || !this.pending) return
    const raw = this.buffer.slice(0, prompt)
    this.buffer = this.buffer.slice(prompt + 1)
    const { resolve, timer } = this.pending
    this.pending = null
    clearTimeout(timer)
    resolve(raw)
  }

  /** Schickt einen Befehl und wartet auf den ">"-Prompt. Befehle werden serialisiert. */
  send(command: string, timeoutMs = 5000): Promise<string[]> {
    const run = async () => {
      this.buffer = ''
      this.log('tx', command)
      const raw = await new Promise<string>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          this.pending = null
          reject(new ElmError(`Zeitüberschreitung bei "${command}"`))
        }, timeoutMs)
        this.pending = { resolve, reject, timer }
        this.transport.write(command + '\r').catch((e: Error) => {
          clearTimeout(timer)
          this.pending = null
          reject(e)
        })
      })
      const lines = splitLines(raw, command)
      this.log('rx', lines.join(' | ') || '(leer)')
      return lines
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
  }

  async initialize(): Promise<AdapterInfo> {
    // Reset kann bei Klonen länger dauern.
    const reset = await this.send('ATZ', 8000)
    const version = reset.find((l) => /ELM|OBD|STN/i.test(l)) ?? reset.join(' ')
    for (const cmd of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATSP0']) {
      await this.send(cmd)
    }

    // Erste Anfrage löst die automatische Protokollsuche aus.
    const probe = await this.send('0100', 20000)
    const error = findError(probe)
    if (error) {
      throw new ElmError(
        `Keine Antwort vom Fahrzeug (${error}). Zündung eingeschaltet?`,
      )
    }

    const protocol = (await this.send('ATDP'))[0] ?? 'unbekannt'
    const protocolNumber = (await this.send('ATDPN'))[0] ?? ''
    this.isCan = CAN_PROTOCOLS.test(protocolNumber)
    this.log('info', `Protokoll: ${protocol}`)
    return { version, protocol, protocolNumber, isCan: this.isCan }
  }

  async getSupportedPids(): Promise<Set<number>> {
    const supported = new Set<number>()
    for (let base = 0x00; base <= 0xa0; base += 0x20) {
      const lines = await this.send('01' + hex(base))
      if (findError(lines)) break
      parseSupportedPids(lines, base).forEach((p) => supported.add(p))
      // Bit 0x20 der jeweiligen Maske zeigt, ob der nächste Block existiert.
      if (!supported.has(base + 0x20)) break
    }
    return supported
  }

  async readPid(def: PidDef): Promise<number | null> {
    const lines = await this.send('01' + hex(def.pid))
    const data = parsePidResponse(lines, def.pid)
    return data ? def.decode(data) : null
  }

  async readDtcs(mode: 0x03 | 0x07 | 0x0a): Promise<string[]> {
    const lines = await this.send(hex(mode), 10000)
    if (findError(lines)) return []
    return parseDtcResponse(lines, mode, this.isCan)
  }

  async clearDtcs(): Promise<void> {
    const lines = await this.send('04', 10000)
    const error = findError(lines)
    if (error) throw new ElmError(`Löschen fehlgeschlagen: ${error}`)
  }

  async readVin(): Promise<string | null> {
    const lines = await this.send('0902', 10000)
    if (findError(lines)) return null
    return parseVin(lines)
  }

  async readBatteryVoltage(): Promise<string | null> {
    const lines = await this.send('ATRV')
    return lines[0] ?? null
  }

  async close() {
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.reject(new ElmError('Verbindung getrennt'))
      this.pending = null
    }
    this.transport.onData = null
    await this.transport.disconnect()
  }
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
