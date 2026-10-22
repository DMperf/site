import type { EcuTarget } from '../obd/link'
import type { CodingDefinition, CodingParameter } from './types'

/**
 * Codierdaten für die Demo-Fahrzeuge (src/sim). Sie passen NUR zu den simulierten
 * Steuergeräten – die Bit-Positionen sind ausgedacht und gelten für kein echtes Auto.
 */

const onOff = [
  { value: 0, name: 'nicht aktiv' },
  { value: 1, name: 'aktiv' },
]

function kombi(did: number, target: EcuTarget, brand: string): CodingDefinition {
  const p = (x: Omit<CodingParameter, 'did'>): CodingParameter => ({ ...x, did })
  return {
    id: `demo-kombi-${brand.toLowerCase()}`,
    name: 'Kombiinstrument',
    brand,
    description: 'Demo – passt nur zum simulierten Fahrzeug.',
    demoOnly: true,
    target,
    match: [{ did: 0xf197, startsWith: 'KOMBI (Demo)' }],
    blocks: [{ did, length: 8 }],
    parameters: [
      p({ id: 'NADEL_SWEEP', name: 'Zeigertest beim Start', byte: 0, mask: 0x01, values: onOff }),
      p({ id: 'DIGITAL_V', name: 'Digitale Geschwindigkeit', byte: 0, mask: 0x02, values: onOff }),
      p({
        id: 'SPORTANZEIGE',
        name: 'Sportanzeigen',
        byte: 0,
        mask: 0x0c,
        values: [
          { value: 0, name: 'aus' },
          { value: 1, name: 'Leistung und Drehmoment' },
          { value: 2, name: 'Ladedruck und Öltemperatur' },
        ],
      }),
      p({
        id: 'GURTWARNUNG',
        name: 'Gurtwarnung',
        byte: 1,
        mask: 0x03,
        values: [
          { value: 0, name: 'aus' },
          { value: 1, name: 'nur Fahrer' },
          { value: 2, name: 'Fahrer und Beifahrer' },
        ],
      }),
      p({ id: 'TANK_LITER', name: 'Tankinhalt in Litern', byte: 1, mask: 0x04, values: onOff }),
      p({
        id: 'TEMPO_WARNUNG',
        name: 'Geschwindigkeitswarnung',
        description: '0 = aus',
        byte: 2,
        numeric: { min: 0, max: 250, unit: 'km/h' },
      }),
      p({
        id: 'LAENDERVARIANTE',
        name: 'Ländervariante',
        byte: 3,
        mask: 0x03,
        values: [
          { value: 0, name: 'ECE' },
          { value: 1, name: 'USA' },
          { value: 2, name: 'Japan' },
        ],
      }),
      p({ id: 'KOMBI_TESTMODUS', name: 'Testmodus Kombi', byte: 3, mask: 0x80, values: onOff }),
    ],
    features: [
      {
        id: 'nadel',
        name: 'Zeigertest beim Motorstart',
        category: 'Anzeige',
        description: 'Die Zeiger fahren beim Start einmal bis zum Anschlag.',
        kind: 'toggle',
        options: [
          { name: 'aus', set: { NADEL_SWEEP: 0 } },
          { name: 'an', set: { NADEL_SWEEP: 1 } },
        ],
      },
      {
        id: 'digital',
        name: 'Digitale Geschwindigkeitsanzeige',
        category: 'Anzeige',
        kind: 'toggle',
        options: [
          { name: 'aus', set: { DIGITAL_V: 0 } },
          { name: 'an', set: { DIGITAL_V: 1 } },
        ],
      },
      {
        id: 'sport',
        name: 'Sportanzeigen',
        category: 'Anzeige',
        kind: 'choice',
        options: [
          { name: 'aus', set: { SPORTANZEIGE: 0 } },
          { name: 'Leistung und Drehmoment', set: { SPORTANZEIGE: 1 } },
          { name: 'Ladedruck und Öltemperatur', set: { SPORTANZEIGE: 2 } },
        ],
      },
      {
        id: 'tank',
        name: 'Tankinhalt in Litern',
        category: 'Anzeige',
        kind: 'toggle',
        options: [
          { name: 'aus', set: { TANK_LITER: 0 } },
          { name: 'an', set: { TANK_LITER: 1 } },
        ],
      },
      {
        id: 'gurt',
        name: 'Gurtwarnung',
        category: 'Warnungen',
        kind: 'choice',
        options: [
          { name: 'aus', set: { GURTWARNUNG: 0 } },
          { name: 'nur Fahrer', set: { GURTWARNUNG: 1 } },
          { name: 'Fahrer und Beifahrer', set: { GURTWARNUNG: 2 } },
        ],
      },
      {
        id: 'tempo',
        name: 'Geschwindigkeitswarnung',
        category: 'Warnungen',
        kind: 'choice',
        options: [
          { name: 'aus', set: { TEMPO_WARNUNG: 0 } },
          { name: '120 km/h', set: { TEMPO_WARNUNG: 120 } },
          { name: '130 km/h', set: { TEMPO_WARNUNG: 130 } },
          { name: '160 km/h', set: { TEMPO_WARNUNG: 160 } },
        ],
      },
    ],
  }
}

function body(did: number, target: EcuTarget, brand: string): CodingDefinition {
  const p = (x: Omit<CodingParameter, 'did'>): CodingParameter => ({ ...x, did })
  return {
    id: `demo-body-${brand.toLowerCase()}`,
    name: 'Karosserie (Licht, Türen, Komfort)',
    brand,
    description: 'Demo – passt nur zum simulierten Fahrzeug.',
    demoOnly: true,
    target,
    match: [{ did: 0xf197, startsWith: 'FEM/BDC (Demo)' }],
    blocks: [{ did, length: 8 }],
    parameters: [
      p({ id: 'SPIEGEL_ANKLAPPEN', name: 'Spiegel anklappen beim Verriegeln', byte: 0, mask: 0x01, values: onOff }),
      p({ id: 'KOMFORT_OEFFNEN', name: 'Komfortöffnen per Fernbedienung', byte: 0, mask: 0x02, values: onOff }),
      p({ id: 'KOMFORT_SCHLIESSEN', name: 'Komfortschließen per Fernbedienung', byte: 0, mask: 0x04, values: onOff }),
      p({
        id: 'BLINK_ANZAHL',
        name: 'Komfortblinker Anzahl',
        byte: 1,
        mask: 0x07,
        values: [
          { value: 1, name: '1×' },
          { value: 3, name: '3×' },
          { value: 5, name: '5×' },
          { value: 7, name: '7×' },
        ],
      }),
      p({ id: 'WILLKOMMENSLICHT', name: 'Willkommenslicht', byte: 1, mask: 0x08, values: onOff }),
      p({ id: 'MSA_MEMORY', name: 'Start-Stopp merkt letzten Zustand', byte: 2, mask: 0x01, values: onOff }),
      p({ id: 'TFL_MENUE', name: 'Tagfahrlicht im Menü abschaltbar', byte: 2, mask: 0x02, values: onOff }),
      p({ id: 'HUPE_VERRIEGELN', name: 'Hupe beim Verriegeln', byte: 2, mask: 0x04, values: onOff }),
      p({
        id: 'COMING_HOME',
        name: 'Heimleuchten-Dauer',
        byte: 3,
        numeric: { min: 0, max: 48, unit: 's', factor: 5 },
      }),
      p({
        id: 'AUTO_VERRIEGELN',
        name: 'Automatisch verriegeln beim Anfahren',
        byte: 4,
        mask: 0x03,
        values: [
          { value: 0, name: 'aus' },
          { value: 1, name: 'ab 8 km/h' },
          { value: 2, name: 'ab 15 km/h' },
        ],
      }),
    ],
    features: [
      {
        id: 'msa',
        name: 'Start-Stopp-Automatik merkt letzten Zustand',
        category: 'Motor',
        description: 'Wer Start-Stopp ausschaltet, muss es nicht bei jeder Fahrt erneut tun.',
        kind: 'toggle',
        options: [
          { name: 'aus', set: { MSA_MEMORY: 0 } },
          { name: 'an', set: { MSA_MEMORY: 1 } },
        ],
      },
      {
        id: 'spiegel',
        name: 'Außenspiegel beim Verriegeln anklappen',
        category: 'Komfort',
        kind: 'toggle',
        options: [
          { name: 'aus', set: { SPIEGEL_ANKLAPPEN: 0 } },
          { name: 'an', set: { SPIEGEL_ANKLAPPEN: 1 } },
        ],
      },
      {
        id: 'komfort',
        name: 'Fenster per Fernbedienung öffnen/schließen',
        category: 'Komfort',
        kind: 'toggle',
        options: [
          { name: 'aus', set: { KOMFORT_OEFFNEN: 0, KOMFORT_SCHLIESSEN: 0 } },
          { name: 'an', set: { KOMFORT_OEFFNEN: 1, KOMFORT_SCHLIESSEN: 1 } },
        ],
      },
      {
        id: 'verriegeln',
        name: 'Automatisch verriegeln beim Anfahren',
        category: 'Komfort',
        kind: 'choice',
        options: [
          { name: 'aus', set: { AUTO_VERRIEGELN: 0 } },
          { name: 'ab 8 km/h', set: { AUTO_VERRIEGELN: 1 } },
          { name: 'ab 15 km/h', set: { AUTO_VERRIEGELN: 2 } },
        ],
      },
      {
        id: 'blinker',
        name: 'Komfortblinker',
        category: 'Licht',
        kind: 'choice',
        options: [
          { name: '1× blinken', set: { BLINK_ANZAHL: 1 } },
          { name: '3× blinken', set: { BLINK_ANZAHL: 3 } },
          { name: '5× blinken', set: { BLINK_ANZAHL: 5 } },
        ],
      },
      {
        id: 'willkommen',
        name: 'Willkommenslicht beim Entriegeln',
        category: 'Licht',
        kind: 'toggle',
        options: [
          { name: 'aus', set: { WILLKOMMENSLICHT: 0 } },
          { name: 'an', set: { WILLKOMMENSLICHT: 1 } },
        ],
      },
      {
        id: 'tfl',
        name: 'Tagfahrlicht im Menü abschaltbar',
        category: 'Licht',
        kind: 'toggle',
        options: [
          { name: 'aus', set: { TFL_MENUE: 0 } },
          { name: 'an', set: { TFL_MENUE: 1 } },
        ],
      },
      {
        id: 'heim',
        name: 'Heimleuchten-Dauer',
        category: 'Licht',
        kind: 'choice',
        options: [
          { name: 'aus', set: { COMING_HOME: 0 } },
          { name: '30 s', set: { COMING_HOME: 6 } },
          { name: '60 s', set: { COMING_HOME: 12 } },
          { name: '120 s', set: { COMING_HOME: 24 } },
        ],
      },
    ],
  }
}

/** Demo-BMW am ENET-Kabel: Kombi 0x60, Karosserie 0x40, Codierblock 0x3000. */
export const DEMO_ENET_DEFINITIONS = [
  kombi(0x3000, { address: 0x60 }, 'Demo-BMW'),
  body(0x3000, { address: 0x40 }, 'Demo-BMW'),
]

/** Demo-Fahrzeug am ELM327: VAG-artige Adressen, Codierung 0x0600. */
export const DEMO_ELM_DEFINITIONS = [
  kombi(0x0600, { tx: 0x714, rx: 0x77e }, 'Demo-VAG'),
  body(0x0600, { tx: 0x70e, rx: 0x778 }, 'Demo-VAG'),
]
