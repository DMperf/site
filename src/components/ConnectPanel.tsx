import { useState } from 'react'
import { BleTransport } from '../obd/bleTransport'
import { SerialTransport } from '../obd/serialTransport'
import { SimulatorTransport } from '../obd/simulatorTransport'
import { isBluetoothSupported, isSerialSupported, type Transport } from '../obd/transport'
import type { Status } from '../hooks/useObd'

interface Props {
  status: Status
  error: string | null
  onConnect: (transport: Transport) => void
}

const BAUD_RATES = [38400, 9600, 115200, 230400, 500000]

export function ConnectPanel({ status, error, onConnect }: Props) {
  const [baud, setBaud] = useState(38400)
  const busy = status === 'connecting'
  const ble = isBluetoothSupported()
  const serial = isSerialSupported()

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold">Mit OBD-Dongle verbinden</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Dongle in die OBD-II-Buchse stecken (meist unter dem Lenkrad), Zündung einschalten,
          dann Verbindungsart wählen.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <button
            className="btn-primary"
            disabled={busy || !ble}
            onClick={() => onConnect(new BleTransport())}
          >
            <span className="text-base">Bluetooth LE</span>
            <span className="text-xs opacity-75">ELM327 BLE, Vgate, OBDLink CX</span>
          </button>

          <div className="flex flex-col gap-2">
            <button
              className="btn-primary"
              disabled={busy || !serial}
              onClick={() => onConnect(new SerialTransport(baud))}
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

          <button
            className="btn-secondary"
            disabled={busy}
            onClick={() => onConnect(new SimulatorTransport())}
          >
            <span className="text-base">Demo-Modus</span>
            <span className="text-xs opacity-75">Ohne Auto ausprobieren</span>
          </button>
        </div>

        {busy && (
          <p className="mt-4 animate-pulse text-sm text-amber-400">
            Verbinde und suche Fahrzeugprotokoll … (kann bis zu 20 s dauern)
          </p>
        )}
        {error && (
          <p className="mt-4 rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-sm text-zinc-400">
        <h3 className="font-medium text-zinc-200">Hinweise</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Bluetooth LE und USB funktionieren in Chrome bzw. Edge (Android, Windows, macOS,
            Linux). Die Seite muss über HTTPS oder localhost laufen.
          </li>
          <li>
            iPhone/iPad: Safari unterstützt kein Web Bluetooth – dort z. B. den Browser
            „Bluefy“ verwenden.
          </li>
          <li>
            Klassische Bluetooth-Dongles (SPP, Pairing-PIN 1234) und WLAN-Dongles lassen sich
            aus dem Browser nicht ansprechen. Benötigt wird ein Bluetooth-<b>LE</b>- oder
            USB-Dongle.
          </li>
          {!ble && <li className="text-amber-400">Dieser Browser unterstützt kein Web Bluetooth.</li>}
          {!serial && <li className="text-amber-400">Dieser Browser unterstützt kein Web Serial.</li>}
        </ul>
      </section>
    </div>
  )
}
