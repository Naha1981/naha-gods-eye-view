# RailWatch Command Center — Demo Runbook

## The story

RailWatch demonstrates a single operational loop:

**DETECT → LOCATE → VERIFY → RESPOND → RESOLVE → PROVE**

Use the live command center to show how a telemetry signal becomes an operator decision, response action, and auditable evidence trail.

## Before the meeting

Open the RailWatch static site and confirm the WebSocket indicator reaches `CONNECTED`.

Use the `SIMULATE LINE BREACH` button once. The map should fly to the demo incident and the incident panel should show the South African corridor demonstration sector, nearby infrastructure and CCTV verification surface.

The Operator Assurance panel should show the current stage, escalation rule, ACK/dispatch timers and replay timeline.

## Five-minute flow

### 1 — DETECT

Click **SIMULATE LINE BREACH**.

Say: “A line-breach signal has arrived. RailWatch validates the event, deduplicates it and opens an incident.”

Point to the incident marker, severity, sensor ID and event fingerprint.

### 2 — LOCATE

Let the camera movement complete.

Say: “The system resolves the signal to a corridor, segment and kilometre marker, then brings the operator directly to the incident geometry.”

Point out the nearby signalling, track and telecommunications assets.

### 3 — VERIFY

Open a nearby asset and select **VIEW CCTV EVIDENCE**.

Say: “The operator sees an evidence surface tied to the incident. In production this adapter can supply HLS/WebRTC camera feeds and recorded clips.”

Return to the incident.

### 4 — RESPOND

Use the Operator Assurance panel: **ACK → VERIFY → DISPATCH**.

Say: “The workflow is role-aware. Operator actions advance the incident monotonically, and each action becomes part of the audit trail.”

Point out the SLA timers and deterministic escalation rule.

### 5 — RESOLVE / PROVE

Run **RESOLVE** then **PROVE**.

Use **REPLAY**.

Say: “The operator can replay the incident timeline from signal to proof. This is the handoff from live operations to after-action review and evidence.”

## Technical proof points

RailWatch now includes:

- authenticated telemetry ingestion and duplicate protection
- HMAC-signed telemetry endpoint with timestamp and nonce replay protection
- operator RBAC tokens for controller, dispatcher, viewer and admin roles
- tenant-scoped incident actions
- PostgreSQL event persistence with fail-closed behaviour when persistence is explicitly required
- append-only, hash-linked server audit records when a database is configured
- deterministic incident rules before any AI recommendation layer
- incident timeline, replay and SLA APIs
- optional Redis fan-out for multi-instance WebSocket distribution
- automated CI plus Render deployment verification

## Safety language

Use this wording:

> “NahaLabs built a rail operations intelligence prototype that demonstrates how existing telemetry can be converted into a live geospatial incident-response workflow.”

Do not present the prototype as an official Transnet control system, certified signalling system, or authoritative representation of field assets.

## Backup path

If the production API is temporarily unavailable, present the UI's existing demo workflow and explain that the corridor, asset and CCTV content is deliberately labelled prototype/demo data. The operational architecture remains the same: telemetry adapter → event API → event store → real-time operator console → evidence/audit.
