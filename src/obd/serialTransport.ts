import type { Transport } from './transport'

/** USB-ELM327 (FTDI/CH340) über die Web Serial API. */
export class SerialTransport implements Transport {
  readonly kind = 'serial' as const
  label = 'USB / Seriell'
  onData: ((chunk: string) => void) | null = null
  onDisconnect: (() => void) | null = null

  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private closing = false
  private encoder = new TextEncoder()
  private baudRate: number

  constructor(baudRate = 38400) {
    this.baudRate = baudRate
  }

  async connect() {
    const port = await navigator.serial.requestPort()
    await port.open({ baudRate: this.baudRate })
    this.port = port
    this.label = `USB (${this.baudRate} Baud)`
    this.closing = false
    void this.readLoop()
  }

  private async readLoop() {
    const decoder = new TextDecoder()
    while (this.port?.readable && !this.closing) {
      this.reader = this.port.readable.getReader()
      try {
        for (;;) {
          const { value, done } = await this.reader.read()
          if (done) break
          if (value) this.onData?.(decoder.decode(value, { stream: true }))
        }
      } catch {
        break
      } finally {
        this.reader.releaseLock()
        this.reader = null
      }
    }
    if (!this.closing) this.onDisconnect?.()
  }

  async disconnect() {
    this.closing = true
    try {
      await this.reader?.cancel()
      await this.port?.close()
    } catch {
      // Port war bereits geschlossen
    }
    this.port = null
  }

  async write(data: string) {
    if (!this.port?.writable) throw new Error('Nicht verbunden')
    const writer = this.port.writable.getWriter()
    try {
      await writer.write(this.encoder.encode(data))
    } finally {
      writer.releaseLock()
    }
  }
}
