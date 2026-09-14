from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from nahallm_client import NahaLLMError, chat, extract_text, get_config


def _incident_or_404(manager: Any, event_id: str) -> dict[str, Any]:
    for payload in reversed(list(manager.events.values())):
        data = payload.get("data", {})
        if data.get("event_id") == event_id:
            return data
    raise HTTPException(status_code=404, detail="Incident not found")


def _context(data: dict[str, Any]) -> str:
    incident = data.get("incident") or {}
    return str({
        "event_id": data.get("event_id"),
        "severity": data.get("severity"),
        "alert_type": data.get("alert_type"),
        "corridor": data.get("corridor"),
        "segment": data.get("segment"),
        "km_marker": data.get("km_marker"),
        "sensor_id": data.get("sensor_id"),
        "timestamp": data.get("timestamp"),
        "incident": {
            "location_name": incident.get("location_name"),
            "asset_type": incident.get("asset_type"),
            "asset_condition": incident.get("asset_condition"),
            "operational_impact": incident.get("operational_impact"),
            "recommended_action": incident.get("recommended_action"),
            "assets": incident.get("assets") or [],
        },
    })


async def _ask(system: str, user: str) -> dict[str, Any]:
    config = get_config()
    if not config.configured:
        raise HTTPException(status_code=503, detail="NahaLLM is not configured")
    try:
        response = await chat([
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ])
        return {
            "text": extract_text(response),
            "request_id": response.get("nahallm", {}).get("request_id"),
            "provider": response.get("nahallm", {}).get("provider"),
            "model": config.model,
        }
    except NahaLLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def install(app: Any, manager: Any) -> None:
    @app.get("/api/v1/ai/status")
    def ai_status() -> dict[str, Any]:
        config = get_config()
        return {"configured": config.configured, "model": config.model if config.configured else None}

    async def run_feature(event_id: str, feature: str) -> dict[str, Any]:
        data = _incident_or_404(manager, event_id)
        prompts: dict[str, tuple[str, str]] = {
            "brief": (
                "You are RailWatch's operator intelligence assistant. Summarise the incident for a human rail operator. "
                "Use only supplied facts. Clearly separate observed facts, inferred risk, and unknowns. "
                "Do not claim authoritative railway data. Do not issue autonomous dispatch or signalling commands. "
                "Use concise headings: SITUATION, WHY IT MATTERS, UNKNOWN, NEXT HUMAN CHECK.",
                "incident_brief",
            ),
            "challenge": (
                "You are RailWatch's independent challenge analyst. Critically examine the recommended operational response. "
                "Do not invent evidence. Identify weak assumptions, missing evidence, contradictory signals, and the single most important "
                "verification question before response. Never override the human operator or issue a control-system command. "
                "Use headings: DECISION TO CHALLENGE, WHAT SUPPORTS IT, WHAT IS MISSING, CHALLENGE QUESTION, SAFE NEXT STEP.",
                "decision_challenge",
            ),
            "summary": (
                "You prepare a professional incident summary for an operations manager. "
                "Summarise only evidence and actions represented in the supplied incident data. "
                "Label demo/schematic information as such. Do not fabricate closure, field verification or authoritative evidence. "
                "Use headings: EXECUTIVE SUMMARY, INCIDENT FACTS, OPERATIONAL IMPACT, RESPONSE STATUS, EVIDENCE GAPS, MANAGEMENT NOTE.",
                "incident_summary",
            ),
        }
        system, feature_name = prompts[feature]
        return {"feature": feature_name, "incident_id": event_id, **await _ask(system, f"Incident context:\n{_context(data)}")}

    @app.post("/api/v1/ai/incident/{event_id}/brief")
    async def incident_brief(event_id: str) -> dict[str, Any]:
        return await run_feature(event_id, "brief")

    @app.post("/api/v1/ai/incident/{event_id}/challenge")
    async def challenge_decision(event_id: str) -> dict[str, Any]:
        return await run_feature(event_id, "challenge")

    @app.post("/api/v1/ai/incident/{event_id}/summary")
    async def incident_summary(event_id: str) -> dict[str, Any]:
        return await run_feature(event_id, "summary")
