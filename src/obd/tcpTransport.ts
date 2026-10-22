import type { ByteSocket, Network } from '../net/socket'
import type { Transport } from './transport'

/** ELM327-WLAN-Dongle (meist 192.168.0.10:35000) über TCP. */
export class TcpTransport implements Transport {
  readonly kind = 'wifi' as const
  label: string
  onData: ((chunk: string) => void) | null = null
  onDisconnect: (() => void) | null = null

  private socket: ByteSocket | null = null
  private decoder = new TextDecoder()
  private encoder = new TextEncoder()
  private network: Network
  private host: string
  private port: number

  constructor(network: Network, host: string, port: number) {
    this.network = network
    this.host = host
    this.port = port
    this.label = `WLAN (${host}:${port})`
  }

  async connect() {
    const socket = await this.network.connectTcp(this.host, this.port, 5000)
    socket.onData = (bytes) => this.onData?.(this.decoder.decode(bytes, { stream: true }))
    socket.onClose = () => {
      this.socket = null
      this.onDisconnect?.()
    }
    this.socket = socket
  }

  async disconnect() {
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onClose = null
      await socket.close()
    }
  }

  async write(data: string) {
    if (!this.socket) throw new Error('Nicht verbunden')
    await this.socket.write(this.encoder.encode(data))
  }
}
