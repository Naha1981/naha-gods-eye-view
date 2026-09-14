from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from nahallm_client import NahaLLMError, chat, extract_text, get_config

router = APIRouter(prefix="/api/v1/ai", tags=["AI intelligence"])


def _incident_or_404(manager: Any, event_id: str) -> dict[str, Any]:
    for payload in reversed(list(manager.events.values())):
        data = payload.get("data", {})
        if data.get("event_id") == event_id:
            return data
    raise HTTPException(status_code=404, detail="Incident not found")


def _context(data: dict[str, Any]) -> str:
    incident = data.get("incident") or {}
    assets = incident.get("assets") or []
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
        },
        "nearby_assets": assets,
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


@router.get("/status")
def ai_status() -> dict[str, Any]:
    config = get_config()
    return {"configured": config.configured, "model": config.model if config.configured else None}


@router.post("/incident/{event_id}/brief")
async def incident_brief(event_id: str, manager: Any) -> dict[str, Any]:
    data = _incident_or_404(manager, event_id)
    system = (
        "You are RailWatch's operator intelligence assistant. Summarise the incident for a human rail operator. "
        "Use only supplied facts. Clearly separate observed facts, inferred risk, and unknowns. "
        "Do not claim authoritative railway data. Do not issue autonomous dispatch or signalling commands. "
        "Use concise headings: SITUATION, WHY IT MATTERS, UNKNOWN, NEXT HUMAN CHECK."
    )
    return {"feature": "incident_brief", "incident_id": event_id, **await _ask(system, f"Incident context:\n{_context(data)}")}


@router.post("/incident/{event_id}/challenge")
async def challenge_decision(event_id: str, manager: Any) -> dict[str, Any]:
    data = _incident_or_404(manager, event_id)
    system = (
        "You are RailWatch's independent challenge analyst. Critically examine the recommended operational response. "
        "Do not invent evidence. Identify weak assumptions, missing evidence, contradictory signals, and the single most important "
        "verification question before response. Never override the human operator or issue a control-system command. "
        "Use headings: DECISION TO CHALLENGE, WHAT SUPPORTS IT, WHAT IS MISSING, CHALLENGE QUESTION, SAFE NEXT STEP."
    )
    return {"feature": "decision_challenge", "incident_id": event_id, **await _ask(system, f"Incident context:\n{_context(data)}")}


@router.post("/incident/{event_id}/summary")
async def incident_summary(event_id: str, manager: Any) -> dict[str, Any]:
    data = _incident_or_404(manager, event_id)
    system = (
        "You prepare a professional incident summary for an operations manager. "
        "Summarise only evidence and actions represented in the supplied incident data. "
        "Label demo/schematic information as such. Do not fabricate closure, field verification or authoritative evidence. "
        "Use headings: EXECUTIVE SUMMARY, INCIDENT FACTS, OPERATIONAL IMPACT, RESPONSE STATUS, EVIDENCE GAPS, MANAGEMENT NOTE."
    )
    return {"feature": "incident_summary", "incident_id": event_id, **await _ask(system, f"Incident context:\n{_context(data)}")}


def install(app: Any, manager: Any) -> None:
    app.include_router(router, dependencies=[])
    for route in app.routes:
        if getattr(route, "path", "") in {"/api/v1/ai/incident/{event_id}/brief", "/api/v1/ai/incident/{event_id}/challenge", "/api/v1/ai/incident/{event_id}/summary"}:
            route.dependant.path_params["manager"] = manager
