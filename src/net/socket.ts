/** Bidirektionale Byte-Verbindung (TCP). */
export interface ByteSocket {
  write(bytes: Uint8Array): Promise<void>
  close(): Promise<void>
  onData: ((bytes: Uint8Array) => void) | null
  onClose: ((error?: string) => void) | null
}

export interface UdpReply {
  address: string
  data: Uint8Array
}

/**
 * Netzwerkzugriff für ENET und WLAN-Dongles. Browser können kein rohes TCP/UDP –
 * daher gibt es eine native Umsetzung (App) und eine simulierte (Demo).
 */
export interface Network {
  connectTcp(host: string, port: number, timeoutMs?: number): Promise<ByteSocket>
  /** Sendet ein UDP-Paket (Broadcast oder Unicast) und sammelt Antworten. */
  udpRequest(host: string, port: number, payload: Uint8Array, timeoutMs: number): Promise<UdpReply[]>
}
