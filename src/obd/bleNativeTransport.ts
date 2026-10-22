import { BleClient, numbersToDataView, numberToUUID } from '@capacitor-community/bluetooth-le'
import type { Transport } from './transport'

// Gleiche Dongle-Services wie in bleTransport.ts, als volle UUIDs.
const KNOWN_SERVICES = [
  numberToUUID(0xfff0),
  numberToUUID(0xffe0),
  numberToUUID(0x18f0),
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
]

const MAX_CHUNK = 20

/** Bluetooth LE über das native Capacitor-Plugin (iPhone und Android-App). */
export class BleNativeTransport implements Transport {
  readonly kind = 'ble' as const
  label = 'Bluetooth LE'
  onData: ((chunk: string) => void) | null = null
  onDisconnect: (() => void) | null = null

  private deviceId: string | null = null
  private rx: { service: string; characteristic: string } | null = null
  private tx: { service: string; characteristic: string; withoutResponse: boolean } | null = null
  private decoder = new TextDecoder()
  private encoder = new TextEncoder()

  async connect() {
    await BleClient.initialize({ androidNeverForLocation: true })
    const device = await BleClient.requestDevice({ optionalServices: KNOWN_SERVICES })
    this.label = device.name ? `Bluetooth: ${device.name}` : 'Bluetooth LE'
    await BleClient.connect(device.deviceId, () => this.onDisconnect?.())
    this.deviceId = device.deviceId

    for (const service of await BleClient.getServices(device.deviceId)) {
      const rx = service.characteristics.find((c) => c.properties.notify || c.properties.indicate)
      const tx = service.characteristics.find((c) => c.properties.write || c.properties.writeWithoutResponse)
      if (rx && tx) {
        this.rx = { service: service.uuid, characteristic: rx.uuid }
        this.tx = {
          service: service.uuid,
          characteristic: tx.uuid,
          withoutResponse: tx.properties.writeWithoutResponse,
        }
        break
      }
    }
    if (!this.rx || !this.tx) {
      await BleClient.disconnect(device.deviceId)
      throw new Error('Kein passender OBD-Service gefunden. Ist das ein Bluetooth-LE-Dongle (ELM327)?')
    }
    await BleClient.startNotifications(device.deviceId, this.rx.service, this.rx.characteristic, (value) => {
      this.onData?.(this.decoder.decode(value))
    })
  }

  async disconnect() {
    const id = this.deviceId
    this.deviceId = null
    if (!id) return
    try {
      if (this.rx) await BleClient.stopNotifications(id, this.rx.service, this.rx.characteristic)
    } catch {
      // Verbindung war schon weg
    }
    await BleClient.disconnect(id).catch(() => undefined)
  }

  async write(data: string) {
    if (!this.deviceId || !this.tx) throw new Error('Nicht verbunden')
    const bytes = [...this.encoder.encode(data)]
    for (let i = 0; i < bytes.length; i += MAX_CHUNK) {
      const chunk = numbersToDataView(bytes.slice(i, i + MAX_CHUNK))
      if (this.tx.withoutResponse) {
        await BleClient.writeWithoutResponse(this.deviceId, this.tx.service, this.tx.characteristic, chunk)
      } else {
        await BleClient.write(this.deviceId, this.tx.service, this.tx.characteristic, chunk)
      }
    }
  }
}
