import { useState } from 'react'
import type { ConnectSpec, Status } from '../hooks/useObd'
import { isNativeApp, NativeNetwork, nativePlatform } from '../net/native'
import type { Network } from '../net/socket'
import { BleNativeTransport } from '../obd/bleNativeTransport'
import { BleTransport } from '../obd/bleTransport'
import { discoverVehicles } from '../obd/enetLink'
import type { VehicleIdent } from '../obd/hsfz'
import { SerialTransport } from '../obd/serialTransport'
import { SimulatorTransport } from '../obd/simulatorTransport'
import { TcpTransport } from '../obd/tcpTransport'
import { isBluetoothSupported, isSerialSupported } from '../obd/transport'
import { SimulatedEnetNetwork, SIM_ENET_IP } from '../sim/hsfzGateway'
import { load, save } from '../storage'

interface Props {
  status: Status
  error: string | null
  onConnect: (spec: ConnectSpec) => void
}

const BAUD_RATES = [38400, 9600, 115200, 230400, 500000]
const WIFI_KEY = 'obd.wifi'
const ENET_IP_KEY = 'obd.enet.ip'

export function ConnectPanel({ status, error, onConnect }: Props) {
  const native = isNativeApp()
  const platform = nativePlatform()
  const [baud, setBaud] = useState(38400)
  const [wifi, setWifi] = useState(() => load(WIFI_KEY, { host: '192.168.0.10', port: 35000 }))
  const [enetIp, setEnetIp] = useState(() => load(ENET_IP_KEY, ''))
  const [searching, setSearching] = useState(false)
  const [found, setFound] = useState<VehicleIdent[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const busy = status === 'connecting' || searching
  const ble = native || isBluetoothSupported()
  const serial = !native && isSerialSupported()

  const connectEnet = (network: Network, host: string, ident: VehicleIdent | null) => {
    onConnect({ type: 'enet', network, host, ident, label: `ENET ${host}` })
  }

  const search = async (network: Network) => {
    setSearching(true)
    setSearchError(null)
    setFound(null)
    try {
      const vehicles = await discoverVehicles(network)
      setFound(vehicles)
      if (vehicles.length === 0) setSearchError('Kein Fahrzeug gefunden. Kabel, Zündung und Netzwerk prüfen – oder IP manuell eingeben.')
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold">OBD-Dongle (ELM327)</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Für alle Marken. Dongle in die OBD-Buchse stecken, Zündung an, Verbindungsart wählen.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <button
            className="btn-primary"
            disabled={busy || !ble}
            onClick={() =>
              onConnect({ type: 'elm327', transport: native ? new BleNativeTransport() : new BleTransport() })
            }
          >
            <span className="text-base">Bluetooth LE</span>
            <span className="text-xs opacity-75">Vgate, Veepeak, OBDLink CX</span>
          </button>

          {native ? (
            <div className="flex flex-col gap-2">
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => {
                  save(WIFI_KEY, wifi)
                  onConnect({ type: 'elm327', transport: new TcpTransport(new NativeNetwork(), wifi.host, wifi.port) })
                }}
              >
                <span className="text-base">WLAN</span>
                <span className="text-xs opacity-75">ELM327 WiFi, OBDLink MX+ WiFi</span>
              </button>
              <div className="flex gap-1">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs"
                  value={wifi.host}
                  onChange={(e) => setWifi({ ...wifi, host: e.target.value.trim() })}
                  aria-label="IP-Adresse des WLAN-Dongles"
                />
                <input
                  className="w-16 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs"
                  value={wifi.port}
                  inputMode="numeric"
                  onChange={(e) => setWifi({ ...wifi, port: Number(e.target.value) || 0 })}
                  aria-label="Port des WLAN-Dongles"
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                className="btn-primary"
                disabled={busy || !serial}
                onClick={() => onConnect({ type: 'elm327', transport: new SerialTransport(baud) })}
              >
                <span className="text-base">USB / Seriell</span>
                <span className="text-xs opacity-75">ELM327 USB, OBDLink SX</span>
              </button>
              <select
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm"
                value={baud}
                onChange={(e) => setBaud(Number(e.target.value))}
                disabled={busy || !serial}
                aria-label="Baudrate"
              >
                {BAUD_RATES.map((b) => (
                  <option key={b} value={b}>
                    {b} Baud
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            className="btn-secondary"
            disabled={busy}
            onClick={() => onConnect({ type: 'elm327', transport: new SimulatorTransport() })}
          >
            <span className="text-base">Demo</span>
            <span className="text-xs opacity-75">Ohne Auto ausprobieren</span>
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold">BMW ENET</h2>
        <p className="mt-1 text-sm text-zinc-400">
          ENET-Kabel (über USB-Ethernet-Adapter) oder WLAN-ENET-Adapter. Für BMW F-/G-Serie, MINI und
          Toyota Supra (A90) mit HSFZ-Diagnose.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="btn-small"
            disabled={busy || !native}
            onClick={() => void search(new NativeNetwork())}
          >
            {searching ? 'Suche …' : 'Fahrzeug suchen'}
          </button>
          <div className="flex gap-2">
            <input
              className="w-40 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 font-mono text-sm"
              placeholder="IP, z. B. 169.254.x.x"
              value={enetIp}
              disabled={!native}
              onChange={(e) => setEnetIp(e.target.value.trim())}
              aria-label="IP-Adresse des Fahrzeugs"
            />
            <button
              className="btn-small"
              disabled={busy || !native || !enetIp}
              onClick={() => {
                save(ENET_IP_KEY, enetIp)
                connectEnet(new NativeNetwork(), enetIp, null)
              }}
            >
              Verbinden
            </button>
          </div>
          <button
            className="btn-small"
            disabled={busy}
            onClick={() => connectEnet(new SimulatedEnetNetwork(), SIM_ENET_IP, null)}
          >
            Demo (BMW)
          </button>
        </div>

        {found && found.length > 0 && (
          <ul className="mt-4 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
            {found.map((v) => (
              <li key={v.address} className="flex items-center gap-3 p-3 text-sm">
                <div className="mr-auto">
                  <div className="font-mono">{v.vin ?? 'Fahrgestellnummer unbekannt'}</div>
                  <div className="text-xs text-zinc-500">{v.address}</div>
                </div>
                <button
                  className="btn-small"
                  disabled={busy}
                  onClick={() => connectEnet(new NativeNetwork(), v.address, v)}
                >
                  Verbinden
                </button>
              </li>
            ))}
          </ul>
        )}
        {searchError && <p className="mt-3 text-sm text-amber-400">{searchError}</p>}
        {!native && (
          <p className="mt-3 text-sm text-amber-400">
            ENET braucht direkten Netzwerkzugriff und funktioniert nur in der iPhone- bzw. Android-App,
            nicht im Browser. Die Demo läuft überall.
          </p>
        )}
      </section>

      {status === 'connecting' && (
        <p className="animate-pulse text-sm text-amber-400">
          Verbinde und suche Fahrzeugprotokoll … (kann bis zu 20 s dauern)
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-sm text-zinc-400">
        <h3 className="font-medium text-zinc-200">Hinweise</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {native ? (
            <>
              <li>
                Bluetooth: nur Bluetooth-LE-Dongles. Klassische Dongles (Pairing-PIN 1234) gehen auf dem
                iPhone grundsätzlich nicht{platform === 'android' ? ' und werden derzeit auch auf Android nicht unterstützt' : ''}.
              </li>
              <li>WLAN-Dongle: Handy mit dem WLAN des Dongles verbinden, dann „WLAN“ tippen.</li>
              <li>
                ENET-Kabel: über USB-C-/Lightning-Ethernet-Adapter anschließen. Wird das Fahrzeug nicht
                gefunden, hilft ein WLAN-ENET-Adapter oder die manuelle IP-Eingabe.
              </li>
            </>
          ) : (
            <>
              <li>
                Im Browser: Bluetooth LE und USB in Chrome/Edge (Android, Windows, macOS, Linux) über HTTPS.
                Safari (iPhone) unterstützt beides nicht – dafür gibt es die App.
              </li>
              <li>WLAN-Dongles und ENET funktionieren nur in der App.</li>
            </>
          )}
          {!ble && <li className="text-amber-400">Dieser Browser unterstützt kein Web Bluetooth.</li>}
        </ul>
      </section>
    </div>
  )
}
