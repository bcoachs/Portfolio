# Dividendenportfolio Tool – Projektstruktur

Diese Projektstruktur dient als Ausgangspunkt für dein Dividendenportfolio‑Tool. Sie enthält eine Beispiel‑Web‑App, Regeln in JSON‑Form, Beispiel‑Daten sowie Vorlagen für Reviews.

## Verzeichnisse

- **app/** – Enthält die Web‑App (HTML, CSS, JS). Hier wird das Dashboard, der Inventur‑Modus und die Admin‑Seite implementiert.
- **rules/** – JSON‑Dateien mit Standardregeln und Grenzwerten. Versionierbar und im Tool veränderbar.
- **data/** – Beispiel‑Daten und Platz für deine Portfolio‑CSV‑Dateien.
- **docs/** – Ablageort für PDFs und ausführliche Dokumente (z. B. One‑Pager).
- **templates/** – Review‑Vorlagen und weitere Texte.
- **exports/** – Ordner für exportierte Protokolle und Berichte.

## Weiterentwicklung

1. **Web‑App erweitern**: Die Dateien in `app/` enthalten Platzhalter und einen einfachen Glass‑Blue‑Look. Implementiere das Einlesen von CSV‑Dateien, das Berechnen von KPI‑Checks sowie das Anzeigen der Portfolio‑Übersicht.
2. **Regeln anpassen**: Passe die Werte in `rules/default_rules.json` an. Über das Admin‑Interface in der App sollen diese Regeln später versioniert geändert werden können.
3. **Daten importieren**: Exportiere dein Portfolio aus Parqet als CSV und lade es über die App hoch.
4. **Inventur nutzen**: Im Inventur‑Modus werden automatisch Positionen angezeigt, die überprüft werden müssen (z. B. Gewicht > 5 %, Dividendenkürzung). Führe die Reviews durch und speichere die Ergebnisse.

## Lokales Backend für Kennzahlen

Damit das Frontend `/api/metrics` nutzen kann, starte das Flask‑Backend:

```bash
python app/server.py
```

Der Server lauscht auf `http://localhost:5000` und nutzt `yfinance`, um die Kennzahlen für `?symbol=...` zu liefern.

Starte mit den bereitgestellten Dateien und passe sie Schritt für Schritt an deine Anforderungen an. Viel Erfolg!
