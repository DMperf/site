import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { ByteSocket, Network, UdpReply } from './socket'

/**
 * Natives Plugin für TCP/UDP (ios/App/App/DiagSocketPlugin.swift,
 * android/app/src/main/java/de/dmperformance/obd/DiagSocketPlugin.java).
 * Daten werden als Base64 übertragen.
 */
interface DiagSocketPlugin {
  connect(options: { host: string; port: number; timeout: number }): Promise<{ id: number }>
  write(options: { id: number; data: string }): Promise<void>
  close(options: { id: number }): Promise<void>
  udpRequest(options: {
    host: string
    port: number
    data: string
    timeout: number
  }): Promise<{ replies: { address: string; data: string }[] }>
  addListener(event: 'data', cb: (e: { id: number; data: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'closed', cb: (e: { id: number; error?: string }) => void): Promise<PluginListenerHandle>
}

const DiagSocket = registerPlugin<DiagSocketPlugin>('DiagSocket')

export const isNativeApp = () => Capacitor.isNativePlatform()
export const nativePlatform = () => Capacitor.getPlatform() as 'ios' | 'android' | 'web'

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

/**
 * Listener werden einmalig registriert und nach Socket-ID verteilt. So gehen keine
 * Daten verloren, die direkt nach dem Verbindungsaufbau eintreffen.
 */
const open = new Map<number, NativeSocket>()
const early = new Map<number, Uint8Array[]>()
let listening: Promise<void> | null = null

function ensureListening() {
  listening ??= (async () => {
    await DiagSocket.addListener('data', (e) => {
      const bytes = fromBase64(e.data)
      const socket = open.get(e.id)
      if (socket) socket.onData?.(bytes)
      else early.set(e.id, [...(early.get(e.id) ?? []), bytes])
    })
    await DiagSocket.addListener('closed', (e) => {
      const socket = open.get(e.id)
      open.delete(e.id)
      socket?.onClose?.(e.error)
    })
  })()
  return listening
}

class NativeSocket implements ByteSocket {
  private _onData: ((bytes: Uint8Array) => void) | null = null
  onClose: ((error?: string) => void) | null = null
  private id: number

  constructor(id: number) {
    this.id = id
  }

  get onData() {
    return this._onData
  }

  set onData(handler: ((bytes: Uint8Array) => void) | null) {
    this._onData = handler
    const pending = early.get(this.id)
    if (handler && pending) {
      early.delete(this.id)
      pending.forEach(handler)
    }
  }

  write(bytes: Uint8Array) {
    return DiagSocket.write({ id: this.id, data: toBase64(bytes) })
  }

  async close() {
    open.delete(this.id)
    early.delete(this.id)
    await DiagSocket.close({ id: this.id }).catch(() => undefined)
  }
}

export class NativeNetwork implements Network {
  async connectTcp(host: string, port: number, timeoutMs = 5000): Promise<ByteSocket> {
    await ensureListening()
    const { id } = await DiagSocket.connect({ host, port, timeout: timeoutMs })
    const socket = new NativeSocket(id)
    open.set(id, socket)
    return socket
  }

  async udpRequest(host: string, port: number, payload: Uint8Array, timeoutMs: number): Promise<UdpReply[]> {
    const { replies } = await DiagSocket.udpRequest({ host, port, data: toBase64(payload), timeout: timeoutMs })
    return replies.map((r) => ({ address: r.address, data: fromBase64(r.data) }))
  }
}
