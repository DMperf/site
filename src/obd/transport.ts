/**
 * Byte-Kanal zum OBD-Dongle. Der ELM327 spricht ASCII: Befehle enden mit "\r",
 * Antworten enden mit dem Prompt ">".
 */
export interface Transport {
  readonly kind: 'ble' | 'serial' | 'wifi' | 'demo'
  readonly label: string
  connect(): Promise<void>
  disconnect(): Promise<void>
  write(data: string): Promise<void>
  onData: ((chunk: string) => void) | null
  onDisconnect: (() => void) | null
}

export const isBluetoothSupported = () =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator

export const isSerialSupported = () =>
  typeof navigator !== 'undefined' && 'serial' in navigator
