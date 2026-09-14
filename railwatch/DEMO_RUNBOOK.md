# RailWatch Command Center — 2–3 Minute Prospect Demo

## The one-line story

**RailWatch turns a physical-world signal into a verified, coordinated and provable operational response.**

The loop is:

**DETECT → LOCATE → VERIFY → RESPOND → RESOLVE → PROVE**

This is a working control-room prototype using deliberately labelled demonstration data. It is not certified rail-control software or authoritative Transnet data.

## 2–3 minute flow

### 0:00–0:20 — Trigger the incident

Click **SIMULATE LINE BREACH**.

Say:

> “Let’s say a physical security or track signal has just arrived. The problem is not detecting the signal. The problem is knowing what it means and what to do next.”

Point to severity, sensor, event ID and fingerprint.

### 0:20–0:50 — Locate and understand

Let the camera move to the incident.

Say:

> “RailWatch connects the signal to a corridor, kilometre marker and nearby infrastructure, so the operator immediately gets context instead of another isolated alert.”

Point out signalling, track and telecommunications assets plus the operational impact.

### 0:50–1:20 — Verify before acting

Open the incident/evidence surface and CCTV area.

Say:

> “The next question is: is this real, and what evidence do we have? RailWatch keeps verification attached to the incident rather than forcing the operator to stitch multiple systems together manually.”

Then point to the recommendation:

**VERIFY → THEN DISPATCH**

Emphasise that the human operator remains in control.

### 1:20–2:00 — Respond and coordinate

Use **ACK → VERIFY → DISPATCH**.

Then open **WHATSAPP OPERATIONS** and show the operator/channel status or pairing surface when configured.

Say:

> “The same incident can move through controlled operational channels. Actions are role-aware, tenant-scoped and recorded against the incident.”

Do not imply WhatsApp itself is the control system. It is the coordination/notification channel.

### 2:00–2:30 — Prove what happened

Run **RESOLVE → PROVE**, then **REPLAY**.

Say:

> “Now the important part: we can show what signal arrived, what was verified, what action was authorised and what proof was preserved. That makes the incident reviewable instead of relying on screenshots, memory and separate logs.”

End on the evidence chain:

**SIGNAL → LOCATION → ASSET → VERIFICATION → RESPONSE → PROOF**

## The NahaLabs positioning

Use this close:

> “NahaLabs is not trying to replace your CCTV, telemetry, GIS or control-room systems. We sit across them and turn their signals into one operational evidence chain — from detection to a defensible decision and proof of what happened.”

## Questions to ask the prospect

Use one or two, not all of them:

- “Where does this process currently break between detection and a verified response?”
- “Which systems does your operator have to open today to answer one incident?”
- “What evidence is available six hours later when management asks what actually happened?”

## Technical proof points

RailWatch includes authenticated telemetry ingestion, duplicate protection, HMAC-signed telemetry with timestamp/nonce replay protection, role-based operator tokens, tenant-scoped incident actions and reads, PostgreSQL persistence, hash-linked audit records, deterministic rules, SLA/replay APIs, optional Redis fan-out, WhatsApp Operator integration, automated CI, deployment verification and production smoke checks.

## Safety language

Use:

> “NahaLabs built a rail operations intelligence prototype that demonstrates how existing telemetry can be converted into a live geospatial incident-response workflow.”

Do not describe it as an official Transnet control system, certified signalling system, autonomous train-control system, or authoritative representation of field assets.

## Backup path

If the production API is unavailable, use the UI demo workflow and state that the corridor, assets and evidence are deliberately labelled prototype/demo content. The architecture remains:

**telemetry adapter → event API → event store → real-time operator console → evidence/audit → coordination channels**
