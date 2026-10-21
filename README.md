# DM Performance – Fahrzeugdiagnose

App für iPhone und Android (und als Web-App im Browser), die mit dem Auto kommuniziert –
über einen ELM327-kompatiblen OBD-Dongle (alle Marken) oder per ENET (BMW, MINI, Toyota Supra A90).

Die Oberfläche ist eine React-Web-App; [Capacitor](https://capacitorjs.com) verpackt sie als
native iOS- und Android-App. Native Plugins liefern, was ein Browser nicht kann:
TCP/UDP für ENET und WLAN-Dongles, Bluetooth LE auf dem iPhone.

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
- **Codierung (UDS)**: Steuergerät wählen (CAN-IDs beim ELM327, Diagnoseadressen bei ENET;
  Vorlagen für OBD-Standard, VAG und BMW), Identifikation lesen, Fehlerspeicher des
  Steuergeräts lesen/löschen, Datenkennungen (DID) lesen und schreiben – mit Bit-Editor,
  automatischer Sicherung und Rücklese-Kontrolle. Steuergeräte mit herstellerspezifischem
  Security Access werden nicht unterstützt.
- **Fahrzeug-Info**: Fahrgestellnummer (VIN), Protokoll, Bordspannung.
- **Terminal**: AT-/OBD-Befehle (ELM327) bzw. UDS-Anfragen (ENET) senden, Kommunikation einsehen.
- **Demo-Modus**: simuliertes Fahrzeug – als ELM327-Dongle und als BMW am ENET-Kabel.

## Verbindungen

| Verbindung | iPhone-App | Android-App | Browser |
| --- | --- | --- | --- |
| Bluetooth LE (Vgate iCar Pro BLE, Veepeak BLE, OBDLink CX) | ✓ | ✓ | Chrome/Edge (nicht Safari) |
| WLAN-Dongle (ELM327 WiFi, Standard 192.168.0.10:35000) | ✓ | ✓ | – |
| USB-Dongle (ELM327 USB, OBDLink SX) | – | – | Chrome/Edge Desktop |
| BMW ENET-Kabel über USB-Ethernet-Adapter | ✓ ¹ | eingeschränkt ² | – |
| BMW WLAN-ENET-Adapter | ✓ ¹ | ✓ | – |

Klassische Bluetooth-Dongles (SPP, Pairing-PIN 1234) werden nicht unterstützt; auf dem iPhone
erlaubt Apple sie grundsätzlich nicht.

¹ Die automatische Fahrzeugsuche nutzt einen UDP-Broadcast. iOS erlaubt das nur mit der
Berechtigung `com.apple.developer.networking.multicast`, die bei Apple beantragt werden muss
([Antrag](https://developer.apple.com/contact/request/networking-multicast)). Ohne sie
funktioniert ENET mit manueller IP-Eingabe.

² Am ENET-Kabel gibt es keinen DHCP-Server. Viele Android-Geräte vergeben sich dann keine
IP-Adresse am USB-Ethernet-Adapter. Zuverlässig ist ein WLAN-ENET-Adapter.

### ENET-Protokoll

BMW HSFZ: Fahrzeugerkennung per UDP an Port 6811, Diagnose per TCP an Port 6801,
Testeradresse 0xF4. Implementiert in `src/obd/hsfz.ts` und `src/obd/enetLink.ts`,
abgeglichen mit [EdiabasLib](https://github.com/uholeschak/ediabaslib).
Neuere Fahrzeuge mit DoIP (ISO 13400) werden noch nicht unterstützt.

## Entwicklung

```bash
npm install
npm run dev      # Web-App: http://localhost:5173
npm test         # Parser-, Messungs- und ENET-Protokolltests
npm run lint
npm run build    # Produktionsbuild nach dist/
```

### Android

Voraussetzung: Android Studio bzw. Android SDK (API 36) und Java 21.

```bash
npm run app:android                  # baut android/app/build/outputs/apk/debug/app-debug.apk
npx cap open android                 # oder in Android Studio öffnen und auf dem Handy starten
```

Die APK wird außerdem bei jedem Push von GitHub Actions gebaut (Workflow „App“, Artefakt
`dm-performance-android-debug`).

### iPhone

Voraussetzung: Mac mit Xcode 26 und ein Apple-Developer-Account (für die Installation auf
dem eigenen iPhone reicht ein kostenloser Account, für TestFlight/App Store das bezahlte
Programm).

```bash
npm run app:sync
npx cap open ios                     # in Xcode Team wählen, iPhone anschließen, Run
```

GitHub Actions kompiliert die iOS-App bei jedem Push (ohne Signatur) als Build-Prüfung.

## Aufbau

```
src/obd/link.ts                Gemeinsame Schnittstelle aller Diagnosezugänge
src/obd/elm327.ts              ELM327: Befehls-Queue, Initialisierung, OBD-Services, UDS über CAN
src/obd/enetLink.ts            BMW ENET: HSFZ-Verbindung, OBD und UDS
src/obd/hsfz.ts                HSFZ-Rahmen, Fahrzeugerkennung
src/obd/transport.ts           Byte-Kanal zum ELM327
src/obd/bleTransport.ts        Bluetooth LE im Browser (Web Bluetooth)
src/obd/bleNativeTransport.ts  Bluetooth LE in der App (Capacitor-Plugin)
src/obd/tcpTransport.ts        WLAN-Dongle über TCP
src/obd/serialTransport.ts     USB im Browser (Web Serial)
src/obd/parse.ts               Parser für OBD-Antworten (inkl. CAN-Mehrfachframes)
src/obd/pids.ts                PID-Definitionen und Umrechnungsformeln
src/obd/uds.ts                 UDS-Dienste (ISO 14229), Steuergeräte-Vorlagen
src/net/                       TCP/UDP-Schnittstelle und native Anbindung
src/sim/                       Demo-Fahrzeug, simulierter ELM327 und BMW-Gateway
src/perf/                      Auswertung Beschleunigung und Leistung
src/components/                Oberfläche
android/.../DiagSocketPlugin.java   Natives TCP/UDP-Plugin (Android)
ios/App/App/DiagSocketPlugin.swift  Natives TCP/UDP-Plugin (iOS)
tests/                         Tests (node:test)
```
