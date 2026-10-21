import type { PidDef } from './pids'

export type LogDirection = 'tx' | 'rx' | 'info' | 'error'
export type Logger = (direction: LogDirection, text: string) => void

export interface AdapterInfo {
  version: string
  protocol: string
  isCan: boolean
}

export interface Timed<T> {
  value: T
  /** Mittelpunkt zwischen Senden und Antwort (performance.now()). */
  t: number
}

/** Steuergerät über CAN-IDs (ELM327, 11 bit). */
export interface CanTarget {
  tx: number
  rx: number
}

/** Steuergerät über Diagnoseadresse (BMW ENET/HSFZ). */
export interface AddressTarget {
  address: number
}

export type EcuTarget = CanTarget | AddressTarget

export const isAddressTarget = (t: EcuTarget): t is AddressTarget => 'address' in t

export class LinkError extends Error {}

/**
 * Gemeinsame Schnittstelle für alle Diagnosezugänge (ELM327 per BLE/USB/WLAN,
 * BMW ENET). Die Oberfläche kennt nur diese Schnittstelle.
 */
export interface VehicleLink {
  readonly kind: 'elm327' | 'enet'
  /** Ob Steuergeräte einzeln per UDS angesprochen werden können (Codierung). */
  readonly supportsUds: boolean
  /** Erklärung für das Terminal, welche Eingaben erwartet werden. */
  readonly terminalHint: string
  readonly terminalPlaceholder: string

  initialize(): Promise<AdapterInfo>
  getSupportedPids(): Promise<Set<number>>
  readPid(def: PidDef): Promise<number | null>
  readPidTimed(def: PidDef): Promise<Timed<number | null>>
  readDtcs(mode: 0x03 | 0x07 | 0x0a): Promise<string[]>
  clearDtcs(): Promise<void>
  readVin(): Promise<string | null>
  readBatteryVoltage(): Promise<string | null>

  /** Richtet UDS-Anfragen auf ein Steuergerät aus; `null` = zurück zu OBD. */
  setTarget(target: EcuTarget | null): Promise<void>
  /** UDS-Anfrage an das gewählte Steuergerät, liefert die Antwortnachricht. */
  request(bytes: number[], timeoutMs?: number): Promise<number[]>
  /** Freitext-Befehl aus dem Terminal. */
  sendRaw(command: string): Promise<string[]>

  close(): Promise<void>
}
