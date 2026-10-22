# Codierdaten-Format

Die Codierung in der App funktioniert wie bei BimmerCode: Steuergerät antippen, Funktionen
umschalten, „Codieren“. Damit das geht, braucht die App für jedes Steuergerät eine
**Codierdefinition**: wo die Codierung gespeichert ist und welches Bit welche Funktion steuert.

Diese Zuordnung hängt vom Steuergerät und seinem Softwarestand ab (bei BMW: CAFD-Version).
Die App enthält Codierdaten nur für die Demo-Fahrzeuge. Für echte Fahrzeuge werden sie als
JSON-Datei importiert (Codierung → „Datei importieren“).

> **Wichtig:** Falsche Bit-Positionen können Steuergeräte funktionsunfähig machen. Nur Daten
> verwenden, die für genau dieses Steuergerät und diesen Softwarestand geprüft sind. Vor jedem
> Schreiben legt die App eine Sicherung an, die sich wiederherstellen lässt.

Ein vollständiges Beispiel: [codierdaten-beispiel.json](codierdaten-beispiel.json).
Eine Datei kann eine Definition oder eine Liste von Definitionen enthalten.
Zahlen dürfen dezimal (`96`) oder als Hex-Text (`"0x60"`) angegeben werden.

## Aufbau

```jsonc
{
  "id": "bmw-f30-kombi-cafd-000000f3",   // eindeutig; gleiche id beim Import ersetzt die alte
  "name": "KOMBI Instrumente",           // Anzeige in der Steuergeräteliste
  "brand": "BMW F30",                    // Gruppierung
  "description": "CAFD 000000F3, I-Stufe F020-17-07",  // für wen die Daten gelten

  // Adresse: ENET → Diagnoseadresse, ELM327 → CAN-IDs { "tx": "0x714", "rx": "0x77E" }
  "target": { "address": "0x60" },

  // Optional: Sicherheitsabfrage. Jede Kennung muss mit dem Text beginnen,
  // sonst warnt die App vor dem Codieren.
  "match": [{ "did": "0xF187", "startsWith": "9325012" }],

  // Datenkennungen (UDS-DIDs), in denen die Codierung liegt, mit Länge in Byte.
  "blocks": [{ "did": "0x3000", "length": 8 }],

  // Optional: Diagnosesitzung zum Schreiben (Standard 0x03) und zusätzliche
  // UDS-Anfragen vor/nach dem Schreiben, z. B. ein Steuergeräte-Reset "11 01".
  "session": "0x03",
  "beforeWrite": [],
  "afterWrite": [],

  "parameters": [ … ],
  "features": [ … ]
}
```

### Parameter (Expertenmodus)

Ein Parameter beschreibt einen Wert innerhalb eines Blocks.

| Feld | Bedeutung |
| --- | --- |
| `id` | Technischer Name, z. B. `SPORTANZEIGE` |
| `name` | Klartext |
| `did`, `byte` | Block und Byte-Position (ab 0) |
| `mask` | Bits innerhalb des Bytes, z. B. `"0x0C"` = Bit 2 und 3. Der Wert wird nach rechts verschoben gelesen: Maske `0x0C`, Byte `0x08` → Wert `2` |
| `length` | Für Zahlen über mehrere Bytes (Big Endian); dann ohne `mask` |
| `values` | Benannte Werte: `[{ "value": 0, "name": "aus" }, …]` |
| `numeric` | Ohne `values`: Zahleneingabe `{ "min": 0, "max": 48, "unit": "s", "factor": 5 }` (Anzeige = Rohwert × factor) |

### Funktionen (Standardansicht)

Eine Funktion ist das, was in der Liste mit Schalter oder Auswahl erscheint.
Jede Option setzt einen oder mehrere Parameter.

```json
{
  "id": "komfort",
  "name": "Fenster per Fernbedienung öffnen/schließen",
  "category": "Komfort",
  "kind": "toggle",
  "options": [
    { "name": "aus", "set": { "KOMFORT_OEFFNEN": 0, "KOMFORT_SCHLIESSEN": 0 } },
    { "name": "an",  "set": { "KOMFORT_OEFFNEN": 1, "KOMFORT_SCHLIESSEN": 1 } }
  ]
}
```

- `kind: "toggle"` – genau zwei Optionen: erst „aus“, dann „an“.
- `kind: "choice"` – Auswahlliste mit beliebig vielen Optionen.
- Passt der aktuelle Stand zu keiner Option, zeigt die App „individuell“.

## Prüfung beim Import

Die App prüft jede Datei, bevor sie übernommen wird: Pflichtfelder, gültige Adressen,
Parameter innerhalb der Blöcke, Werte passend zur Maske, Funktionen verweisen nur auf
vorhandene Parameter und erlaubte Werte. Fehlerhafte Dateien werden mit Begründung abgelehnt.

Beim Codieren liest die App die Blöcke und prüft die Länge. Passt sie nicht zur Definition,
wird abgebrochen.

## Grenzen

- Steuergeräte, die vor dem Schreiben eine herstellerspezifische Freischaltung
  (UDS Security Access, Dienst 0x27) verlangen, werden nicht unterstützt.
- Bei neueren BMW-Steuergeräten mit signierter Codierung (Secure Coding) reicht das
  Beschreiben der Datenkennung nicht aus.
