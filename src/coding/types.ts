import type { EcuTarget } from '../obd/link'

/**
 * Codierdaten für ein Steuergerät: welche Datenkennungen (DIDs) die Codierung
 * enthalten, welche Parameter in welchen Bits liegen und welche verständlichen
 * Funktionen sich daraus ergeben.
 *
 * Das Format ist dokumentiert in docs/codierdaten.md.
 */
export interface CodingDefinition {
  /** Eindeutige Kennung, z. B. "bmw-f30-kombi-v5". */
  id: string
  /** Anzeigename, z. B. "KOMBI Instrumente". */
  name: string
  /** Marke/Plattform, nur zur Anzeige und Gruppierung. */
  brand: string
  /** Kurze Beschreibung, für welche Fahrzeuge/Softwarestände die Daten gelten. */
  description?: string
  /** Nur im Demo-Modus anbieten. */
  demoOnly?: boolean
  /** Adresse des Steuergeräts: Diagnoseadresse (ENET) oder CAN-IDs (ELM327). */
  target: EcuTarget
  /**
   * Erkennung: Kennungen, deren Inhalt mit dem Text beginnen muss (z. B. Teilenummer
   * in F187). Passt eine Bedingung nicht, wird die Definition nicht verwendet.
   */
  match?: { did: number; startsWith: string }[]
  /** Datenkennungen mit Codierdaten und ihre erwartete Länge in Byte. */
  blocks: { did: number; length: number }[]
  /** Diagnosesitzung zum Schreiben (Standard 0x03 = erweitert). */
  session?: number
  /** Zusätzliche UDS-Anfragen vor bzw. nach dem Schreiben (Hex, z. B. "31 01 0F 01"). */
  beforeWrite?: string[]
  afterWrite?: string[]
  parameters: CodingParameter[]
  features: CodingFeature[]
}

/** Ein Wert im Codierblock: einzelne Bits eines Bytes oder eine Zahl über mehrere Bytes. */
export interface CodingParameter {
  /** Technischer Name, z. B. "SPORT_DISPLAYS". */
  id: string
  /** Klartext für den Expertenmodus. */
  name: string
  description?: string
  did: number
  byte: number
  /** Bitmaske innerhalb des Bytes (Standard 0xFF). Nur bei length = 1. */
  mask?: number
  /** Anzahl Bytes für Zahlenwerte (Big Endian, Standard 1). */
  length?: number
  /** Benannte Werte. Ohne Liste wird der Wert als Zahl bearbeitet. */
  values?: { value: number; name: string }[]
  /** Darstellung von Zahlenwerten: angezeigt = roh × factor. */
  numeric?: { min: number; max: number; unit?: string; factor?: number }
}

/** Verständliche Funktion (wie in BimmerCode): eine Auswahl, die Parameter setzt. */
export interface CodingFeature {
  id: string
  name: string
  category: string
  description?: string
  /** Optionen; bei Schaltern genau zwei (aus, an). */
  options: { name: string; set: Record<string, number> }[]
  kind: 'toggle' | 'choice'
}

/** Gelesene Codierdaten je DID. */
export type CodingData = Record<number, number[]>

export interface CodingBackup {
  date: string
  definitionId: string | null
  ecuName: string
  target: EcuTarget
  did: number
  before: number[]
  after: number[]
}
