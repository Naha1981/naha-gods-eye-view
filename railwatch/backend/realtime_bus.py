from __future__ import annotations

import asyncio
import json
import logging
import os

logger = logging.getLogger("railwatch.realtime")


def install(app, manager) -> None:
    url = os.getenv("RAILWATCH_REDIS_URL", "").strip()
    if not url or getattr(app.state, "railwatch_realtime_installed", False):
        return
    try:
        import redis.asyncio as redis
    except ImportError:
        logger.warning("Redis dependency unavailable; using local WebSocket broadcast only")
        return

    setattr(app.state, "railwatch_realtime_installed", True)
    client = redis.from_url(url, decode_responses=True, socket_connect_timeout=2)
    channel = os.getenv("RAILWATCH_REDIS_CHANNEL", "railwatch:events")
    instance_id = os.getenv("RENDER_INSTANCE_ID", "local")
    main = __import__("main")
    original = main._store_and_broadcast

    async def publish(payload: dict) -> None:
        try:
            message = {"origin": instance_id, "payload": payload}
            await client.publish(channel, json.dumps(message, separators=(",", ":")))
        except Exception as exc:
            logger.warning("RailWatch Redis publish failed: %s", exc)

    async def wrapped(alert, dedupe_key):
        result = await original(alert, dedupe_key)
        if result.get("status") == "accepted":
            payload = manager.events.get(dedupe_key)
            if payload:
                await publish(payload)
        return result

    main._store_and_broadcast = wrapped

    async def subscriber() -> None:
        try:
            pubsub = client.pubsub()
            await pubsub.subscribe(channel)
            async for item in pubsub.listen():
                if item.get("type") != "message":
                    continue
                try:
                    message = json.loads(item.get("data", "{}"))
                    if message.get("origin") == instance_id:
                        continue
                    payload = message.get("payload") or {}
                    event_id = payload.get("data", {}).get("event_id")
                    if not event_id:
                        continue
                    manager.events[event_id] = payload
                    while len(manager.events) > int(os.getenv("RAILWATCH_MAX_EVENTS", "2000")):
                        manager.events.pop(next(iter(manager.events)), None)
                    await manager.broadcast(payload)
                    try:
                        from operations import register_incident
                        register_incident(payload, actor="redis", source="redis-event-bus")
                    except Exception:
                        pass
                except Exception as exc:
                    logger.warning("RailWatch Redis message handling failed: %s", exc)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("RailWatch Redis subscriber stopped: %s", exc)

    app.state.railwatch_realtime_task = asyncio.create_task(subscriber())
