# DM Performance – OBD Diagnose

Web-App, die über einen ELM327-kompatiblen OBD-II-Dongle mit dem Auto kommuniziert.
Läuft komplett im Browser, ohne Server und ohne App-Store.

## Funktionen

- **Live-Daten**: Drehzahl, Geschwindigkeit, Temperaturen, Last, Drosselklappe,
  Saugrohrdruck, Ladedruck (berechnet), MAF, Zündzeitpunkt, Kraftstofftrims u. v. m.
  Es werden nur PIDs angeboten, die das Fahrzeug tatsächlich unterstützt.
- **Datenlogger**: Aufnahme als CSV (Excel-kompatibel, `;`-getrennt).
- **Beschleunigung**: 0–50/100/150/200 km/h, 100 m, 1/8 und 1/4 Meile (mit Endgeschwindigkeit),
  Durchzug 60–100, 80–120, 100–150, 100–200 km/h. Start automatisch beim Losfahren,
  Zeitpunkte werden zwischen Messpunkten interpoliert (typisch ±0,1 s). Bestzeiten und Verlauf.
- **Leistungsmessung**: PS- und Nm-Kurve aus einem Vollgaszug im 3. Gang
  (Fahrwiderstände, Massenträgheit, Antriebsverlust). Geschwindigkeit wird aus der fein
  aufgelösten Drehzahl berechnet.
- **Fehlercodes**: gespeicherte, ausstehende und permanente DTCs lesen
  (Mode 03/07/0A), Fehlerspeicher löschen (Mode 04).
- **Codierung (UDS)**: Steuergerät per CAN-Adresse wählen (OBD-Standard und VAG-Vorlagen),
  Identifikation lesen, Fehlerspeicher des Steuergeräts lesen/löschen, Datenkennungen (DID)
  lesen und schreiben – mit Bit-Editor, automatischer Sicherung und Rücklese-Kontrolle.
  Steuergeräte mit herstellerspezifischem Security Access werden nicht unterstützt.
- **Fahrzeug-Info**: Fahrgestellnummer (VIN), OBD-Protokoll, Bordspannung.
- **Terminal**: beliebige AT-/OBD-Befehle senden, komplette Kommunikation einsehen.
- **Demo-Modus**: simuliertes Fahrzeug zum Ausprobieren ohne Auto.

## Unterstützte Dongles

| Verbindung | Browser | Beispiele |
| --- | --- | --- |
| Bluetooth LE (Web Bluetooth) | Chrome/Edge auf Android, Windows, macOS, Linux; iOS nur mit „Bluefy“ | Vgate iCar Pro BLE, Veepeak OBDCheck BLE, OBDLink CX, ELM327-BLE-Klone |
| USB (Web Serial) | Chrome/Edge Desktop | ELM327 USB (FTDI/CH340), OBDLink SX |

Nicht möglich aus dem Browser: klassische Bluetooth-Dongles (SPP, PIN 1234) und WLAN-Dongles.
Web Bluetooth/Serial benötigen HTTPS (oder `localhost`).

## Entwicklung

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # Produktionsbuild nach dist/
npm run lint
```

## Aufbau

```
src/obd/transport.ts           Schnittstelle für den Byte-Kanal
src/obd/bleTransport.ts        Web Bluetooth (BLE-GATT, Notify + Write)
src/obd/serialTransport.ts     Web Serial (USB)
src/obd/simulatorTransport.ts  Simulierter ELM327 für den Demo-Modus
src/obd/elm327.ts              Befehls-Queue, Initialisierung, OBD-Services
src/obd/parse.ts               Parser für ELM327-Antworten (inkl. CAN-Mehrfachframes)
src/obd/pids.ts                PID-Definitionen und Umrechnungsformeln
src/obd/uds.ts                 UDS-Dienste (ISO 14229) für Codierung und Steuergeräte-Fehler
src/perf/acceleration.ts       Auswertung Beschleunigungsmessung
src/perf/dyno.ts               Leistungsberechnung aus dem Vollgaszug
src/components/                UI (Verbinden, Live-Daten, Fehlercodes, Fahrzeug, Terminal)
```
