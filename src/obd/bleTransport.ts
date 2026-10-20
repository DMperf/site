import type { Transport } from './transport'

// GATT-Services, die gängige BLE-ELM327-Dongles verwenden
// (Vgate iCar Pro, Veepeak, OBDLink CX, diverse Klone).
const KNOWN_SERVICES: BluetoothServiceUUID[] = [
  0xfff0,
  0xffe0,
  0x18f0,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
]

const MAX_CHUNK = 20

export class BleTransport implements Transport {
  readonly kind = 'ble' as const
  label = 'Bluetooth LE'
  onData: ((chunk: string) => void) | null = null
  onDisconnect: (() => void) | null = null

  private device: BluetoothDevice | null = null
  private rx: BluetoothRemoteGATTCharacteristic | null = null
  private tx: BluetoothRemoteGATTCharacteristic | null = null
  private decoder = new TextDecoder()
  private encoder = new TextEncoder()

  async connect() {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: KNOWN_SERVICES,
    })
    this.device = device
    this.label = device.name ? `Bluetooth: ${device.name}` : 'Bluetooth LE'
    device.addEventListener('gattserverdisconnected', this.handleDisconnect)

    const server = await device.gatt!.connect()
    const services = await server.getPrimaryServices()

    // Bevorzugt einen Service, der Notify und Write zugleich anbietet.
    for (const service of services) {
      const chars = await service.getCharacteristics()
      const rx = chars.find((c) => c.properties.notify || c.properties.indicate)
      const tx = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse)
      if (rx && tx) {
        this.rx = rx
        this.tx = tx
        break
      }
    }
    if (!this.rx || !this.tx) {
      server.disconnect()
      throw new Error(
        'Kein passender OBD-Service gefunden. Ist das ein Bluetooth-LE-Dongle (ELM327)?',
      )
    }

    this.rx.addEventListener('characteristicvaluechanged', this.handleNotify)
    await this.rx.startNotifications()
  }

  async disconnect() {
    try {
      this.rx?.removeEventListener('characteristicvaluechanged', this.handleNotify)
      await this.rx?.stopNotifications()
    } catch {
      // Verbindung war schon weg
    }
    this.device?.removeEventListener('gattserverdisconnected', this.handleDisconnect)
    this.device?.gatt?.disconnect()
    this.device = null
    this.rx = null
    this.tx = null
  }

  async write(data: string) {
    if (!this.tx) throw new Error('Nicht verbunden')
    const bytes = this.encoder.encode(data)
    for (let i = 0; i < bytes.length; i += MAX_CHUNK) {
      const chunk = bytes.slice(i, i + MAX_CHUNK)
      if (this.tx.properties.writeWithoutResponse) {
        await this.tx.writeValueWithoutResponse(chunk)
      } else {
        await this.tx.writeValueWithResponse(chunk)
      }
    }
  }

  private handleNotify = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value
    if (value) this.onData?.(this.decoder.decode(value))
  }

  private handleDisconnect = () => {
    this.onDisconnect?.()
  }
}
