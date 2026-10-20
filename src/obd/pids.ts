/** Mode-01-PIDs nach SAE J1979. `decode` bekommt die Datenbytes A, B, … */
export interface PidDef {
  pid: number
  name: string
  unit: string
  min: number
  max: number
  decimals: number
  decode: (d: number[]) => number
}

const pct = (a: number) => (a * 100) / 255
const trim = (a: number) => ((a - 128) * 100) / 128
const word = (d: number[]) => d[0] * 256 + d[1]

export const PIDS: PidDef[] = [
  { pid: 0x0c, name: 'Drehzahl', unit: 'U/min', min: 0, max: 8000, decimals: 0, decode: (d) => word(d) / 4 },
  { pid: 0x0d, name: 'Geschwindigkeit', unit: 'km/h', min: 0, max: 260, decimals: 0, decode: (d) => d[0] },
  { pid: 0x04, name: 'Motorlast', unit: '%', min: 0, max: 100, decimals: 0, decode: (d) => pct(d[0]) },
  { pid: 0x11, name: 'Drosselklappe', unit: '%', min: 0, max: 100, decimals: 0, decode: (d) => pct(d[0]) },
  { pid: 0x49, name: 'Gaspedal', unit: '%', min: 0, max: 100, decimals: 0, decode: (d) => pct(d[0]) },
  { pid: 0x05, name: 'Kühlmittel', unit: '°C', min: -40, max: 130, decimals: 0, decode: (d) => d[0] - 40 },
  { pid: 0x5c, name: 'Öltemperatur', unit: '°C', min: -40, max: 160, decimals: 0, decode: (d) => d[0] - 40 },
  { pid: 0x0f, name: 'Ansaugluft', unit: '°C', min: -40, max: 80, decimals: 0, decode: (d) => d[0] - 40 },
  { pid: 0x46, name: 'Außentemperatur', unit: '°C', min: -40, max: 50, decimals: 0, decode: (d) => d[0] - 40 },
  { pid: 0x0b, name: 'Saugrohrdruck', unit: 'kPa', min: 0, max: 255, decimals: 0, decode: (d) => d[0] },
  { pid: 0x33, name: 'Luftdruck', unit: 'kPa', min: 70, max: 110, decimals: 0, decode: (d) => d[0] },
  { pid: 0x10, name: 'Luftmasse (MAF)', unit: 'g/s', min: 0, max: 300, decimals: 1, decode: (d) => word(d) / 100 },
  { pid: 0x0e, name: 'Zündzeitpunkt', unit: '°', min: -20, max: 50, decimals: 1, decode: (d) => d[0] / 2 - 64 },
  { pid: 0x06, name: 'Kurzzeit-Trim B1', unit: '%', min: -25, max: 25, decimals: 1, decode: (d) => trim(d[0]) },
  { pid: 0x07, name: 'Langzeit-Trim B1', unit: '%', min: -25, max: 25, decimals: 1, decode: (d) => trim(d[0]) },
  { pid: 0x23, name: 'Raildruck', unit: 'bar', min: 0, max: 2500, decimals: 0, decode: (d) => word(d) / 10 },
  { pid: 0x2f, name: 'Tankfüllstand', unit: '%', min: 0, max: 100, decimals: 0, decode: (d) => pct(d[0]) },
  { pid: 0x5e, name: 'Verbrauch', unit: 'L/h', min: 0, max: 40, decimals: 1, decode: (d) => word(d) / 20 },
  { pid: 0x42, name: 'Steuergerätespannung', unit: 'V', min: 10, max: 16, decimals: 2, decode: (d) => word(d) / 1000 },
  { pid: 0x1f, name: 'Laufzeit seit Start', unit: 's', min: 0, max: 3600, decimals: 0, decode: (d) => word(d) },
]

export const PID_BY_ID = new Map(PIDS.map((p) => [p.pid, p]))

/** Standardauswahl für die Live-Ansicht. */
export const DEFAULT_SELECTION = [0x0c, 0x0d, 0x05, 0x04, 0x11, 0x0b, 0x0f, 0x42]

/** Abgeleiteter Wert: Ladedruck = Saugrohrdruck − Luftdruck (bar). */
export const BOOST = {
  key: 'boost',
  name: 'Ladedruck',
  unit: 'bar',
  min: -1,
  max: 2.5,
  decimals: 2,
}
