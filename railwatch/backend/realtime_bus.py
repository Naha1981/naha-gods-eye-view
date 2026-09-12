from __future__ import annotations

import asyncio
import json
import logging
import os

logger = logging.getLogger("railwatch.realtime")


def install(app, manager) -> None:
    url = os.getenv("RAILWATCH_REDIS_URL", "").strip()
    if not url:
        return
    try:
        import redis.asyncio as redis
    except ImportError:
        logger.warning("Redis dependency unavailable; using local WebSocket broadcast only")
        return

    client = redis.from_url(url, decode_responses=True, socket_connect_timeout=2)
    channel = os.getenv("RAILWATCH_REDIS_CHANNEL", "railwatch:events")
    instance_id = os.getenv("RENDER_INSTANCE_ID", "local")
    original = None

    async def publish(payload: dict) -> None:
        try:
            message = {"origin": instance_id, "payload": payload}
            await client.publish(channel, json.dumps(message, separators=(",", ":")))
        except Exception as exc:
            logger.warning("RailWatch Redis publish failed: %s", exc)

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
                except Exception as exc:
                    logger.warning("RailWatch Redis message handling failed: %s", exc)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("RailWatch Redis subscriber stopped: %s", exc)

    @app.on_event("startup")
    async def _start_realtime() -> None:
        nonlocal original
        original = getattr(__import__("main"), "_store_and_broadcast")

        async def wrapped(alert, dedupe_key):
            result = await original(alert, dedupe_key)
            if result.get("status") == "accepted":
                payload = manager.events.get(dedupe_key)
                if payload:
                    await publish(payload)
            return result

        __import__("main")._store_and_broadcast = wrapped
        app.state.railwatch_realtime_task = asyncio.create_task(subscriber())

    @app.on_event("shutdown")
    async def _stop_realtime() -> None:
        task = getattr(app.state, "railwatch_realtime_task", None)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await client.aclose()
