# ADDENDUM 01 — Korrektur des Bounty-Befunds

**Zum Bericht:** `/root/ops/HEDERA_NOMOS_X402_REUSE_ASSESSMENT.md` (2026-07-22)
**Betrifft ausschließlich:** Kapitel 5 „Bounty-Anforderungen" und die davon abhängigen Aussagen in §7.2 (Zeile „Fertigstellung bis Deadline") und §11 Einschränkung 1.
**Erstellt:** 2026-07-22
**Alle übrigen forensischen Befunde des Berichts bleiben unverändert und gelten weiter.**

---

## 1. Was falsch war

Der Bericht stufte Phase 4 als **`BLOCKED_NO_OPEN_BOUNTY`** ein, mit der Begründung, `ai-bounties.hedera.com` melde „No bounty is open right now" und die 5-Wochen-Kampagne (18.05.–21.06.2026) sei abgeschlossen.

**Diese Einstufung war falsch.** Sie war für die *AI-Studio-Agent-Bounty-Kampagne* korrekt, aber ich habe daraus geschlossen, es gebe keine offene Hedera-x402-Bounty. Tatsächlich existiert eine **separate, eigenständige** Bounty unter einer anderen URL:

**https://hedera.com/x402-bounty/**

Der Fehler war ein Suchfehler, kein Verifikationsfehler: ich habe die AI-Bounty-Seite als *die* Bounty-Quelle behandelt, statt die x402-spezifische Seite zu suchen. Die von mir zitierten Aussagen über die AI-Studio-Kampagne bleiben zutreffend — sie beschreiben nur ein anderes Programm.

## 2. Der korrekte Befund

Bestätigte Anforderungen der offenen Bounty:

| Anforderung | Wert |
|---|---|
| **Deadline** | **31. Juli 2026, 23:59 ET** |
| **Preise** | 5 × 1.000 USD |
| **Netzwerk** | Hedera **Testnet** |
| **Zahlungsmittel** | **HBAR oder USDC** |
| **Ablauf** | x402 **End-to-End** |
| **On-chain** | **reale** Transaktionen erforderlich |
| **Repository** | öffentlich, Open Source, GitHub |
| **Nachweis** | **HashScan-Links** zu den relevanten Transaktionen |
| **Video** | Demo **unter 5 Minuten**, voller End-to-End-Ablauf |
| **Einreichung** | Formular |
| **Bewertung** | funktionierender E2E-Flow · reale On-chain-Zahlungen über x402 · wie gut Hedera-Rails genutzt werden |
| **HCS** | **nicht** als Pflicht genannt → Bonus/Differenzierung, nicht Voraussetzung |
| **Vorgeschriebenes Package** | keines; Referenzprojekte sind Startpunkte, keine Vorschrift |
| **Lizenz** | nicht spezifiziert → freie Wahl, „Open Source" ist die einzige Auflage |

**Verlinkte Referenzprojekte:** `matevszm/x402-hedera-example` und `hedera-dev/scaffold-hbar` (Branch `templates/x402-pay-per-use`).

## 3. Was sich dadurch am Bericht ändert

**§5 vollständig ersetzt.** Status `BLOCKED_NO_OPEN_BOUNTY` → **`BOUNTY_OPEN_DEADLINE_2026-07-31T23:59_ET`**. Die dort als „nicht ermittelbar" geführten Punkte — Deadline, Netzwerk, Zahlungsmittel, Videoanforderung, Einreichungsformular, Bewertungskriterien, HCS-Status, Package-Vorgabe, Lizenz — sind jetzt **alle beantwortet** (Tabelle oben). Nur die Ausschlusskriterien werden auf der Seite weiterhin nicht explizit genannt.

**§7.2, letzte Zeile.** „🔴 nicht bewertbar — es gibt keine Deadline" ist hinfällig. Die Deadline ist der **31.07.2026, 23:59 ET** — ab dem Zeitpunkt dieses Addendums also **rund 9 Tage**. Der im Bericht geschätzte Aufwand von 5–8 Tagen passt in dieses Fenster, aber ohne Puffer: CP-H2 (echter Testnet-Zahlungspfad) ist der kritische Pfad, und Video plus Einreichung brauchen einen eigenen Tag.

**§11, Einschränkung 1.** „Es gibt derzeit keine offene Bounty … Ein Bau gegen die Deadline ist heute nicht planbar" entfällt ersatzlos.

**§8, Checkpoint CP-H0-b.** Die dort geführte offene Prüfung „offene Bounty-Runde" ist damit **geschlossen**. Die drei übrigen Fragen (Package-Version für Hedera-`exact`, Agent-Kit-Lizenz, EVM-Relay vs. nativ) bleiben offen und sind inzwischen teilweise beantwortet — siehe `docs/architecture/REFERENCE_NOTES.md` im Implementierungs-Repository.

## 4. Was sich NICHT ändert

Ausdrücklich unverändert bleiben alle Befunde zu:

- dem gefundenen Hedera-Bestand (§2) einschließlich der mirror-node-verifizierten IDs und Balances,
- dem 🔴 Schlüsselbefund §2.3 (der gefundene, gefüllte Testnet-Account ist wegen SEC-HEDERA-A1 als verbrannt zu behandeln) — die Bounty-Vorgabe „Testnet" ändert daran **nichts**, im Gegenteil: sie deckt sich mit der Sicherheitsempfehlung,
- der Beacon-Klassifikation (§3) und der Antwort **PARTIAL** auf die HCS-Kernfrage,
- der Reuse-Matrix (§4),
- der Gap-Analyse (§7) einschließlich aller `UNSAFE_FOR_PUBLIC_REPO`-Einstufungen,
- der Minimalarchitektur (§6) und dem Checkpoint-Plan (§8),
- den Sicherheits- und Open-Source-Grenzen (§9),
- dem Evidence-Index (§10).

Der Gesamtstatus des Berichts — **`HEDERA_REUSE_PARTIAL_ADAPTERS_REQUIRED`** — bleibt ebenfalls gültig. Er beschreibt den technischen Bestand, nicht die Bounty-Lage.

## 5. Auswirkung auf die Empfehlung

Die Empfehlung bleibt **GO_WITH_LIMITATIONS**, aber die Begründung verschiebt sich: von „es gibt kein Ziel, gegen das man bauen könnte" zu „es gibt ein Ziel, und es ist eng". Zwei Punkte sind jetzt bewertungsrelevant:

1. **Reale On-chain-Zahlungen sind Pflicht, nicht Kür.** Ein Mock-Settlement disqualifiziert die Einreichung faktisch, weil „real on-chain payments through x402" ein explizites Bewertungskriterium ist. CP-H2 ist damit kein Zwischenschritt, sondern die Mindestanforderung.
2. **HCS ist keine Pflicht.** Der HCS-Anchor — der Teil, für den im Bestand tatsächlich funktionierende Vorarbeit existiert — ist damit reine Differenzierung. Das ist eine gute Nachricht für die Terminplanung: fällt CP-H7 aus, bleibt die Einreichung gültig. Es ist zugleich ein Argument dafür, ihn trotzdem zu bauen, weil „wie gut nutzt der Build Hedera-Rails" ein Bewertungskriterium ist und HCS genau das ist.

---

**Addendum-Status:** `BOUNTY_FINDING_CORRECTED_REPORT_OTHERWISE_UNCHANGED`
