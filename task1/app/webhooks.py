import hmac
import json
import logging
from time import perf_counter
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from psycopg import OperationalError
from starlette.concurrency import run_in_threadpool

from app.database import connect_db
from app.events import CallEvent
from app.event_log import emit
from app.processing import process_one


router = APIRouter()


def signature_matches(raw_body: bytes, signature: str | None, secret: bytes) -> bool:
    if not signature or not signature.isascii():
        return False
    expected = hmac.digest(secret, raw_body, "sha256").hex()
    return hmac.compare_digest(expected, signature.lower())


def reject_json_constant(value: str) -> None:
    raise ValueError(f"{value} is not a JSON value")


def validate_event(raw_body: bytes) -> CallEvent:
    try:
        payload = json.loads(raw_body.decode("utf-8"), parse_constant=reject_json_constant)
        return CallEvent.model_validate(payload)
    except (ValueError, OverflowError, RecursionError):
        raise HTTPException(status_code=422, detail="Invalid call event") from None


def store_event(event: CallEvent, raw_body: bytes) -> Literal["accepted", "duplicate", "conflict"]:
    with connect_db() as connection:
        inserted = connection.execute(
            """
            INSERT INTO webhook_events (
                event_id, event_type, account_id, call_id, occurred_at,
                duration_seconds, cost_cents, destination_country, raw_body
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_id) DO NOTHING
            RETURNING event_id
            """,
            (
                event.event_id, event.event_type, event.account_id, event.call_id,
                event.timestamp, event.duration_seconds, event.cost_cents,
                event.destination_country, raw_body,
            ),
        ).fetchone()
        if inserted is not None:
            return "accepted"

        existing = connection.execute(
            "SELECT raw_body FROM webhook_events WHERE event_id = %s", (event.event_id,)
        ).fetchone()
        if existing is None:
            raise OperationalError("Conflicting event disappeared before lookup")
        return "duplicate" if existing[0] == raw_body else "conflict"


@router.post("/webhooks/calls", status_code=202)
async def receive_call(request: Request, response: Response, background: BackgroundTasks) -> dict[str, str]:
    started = perf_counter()
    event = None
    result, status = "error", 500
    try:
        raw_body = await request.body()
        if not signature_matches(raw_body, request.headers.get("X-Signature"), request.app.state.webhook_secret):
            result, status = "invalid_signature", 401
            raise HTTPException(status, "Invalid signature")
        result, status = "invalid_event", 422
        event = validate_event(raw_body)
        try:
            result = await run_in_threadpool(store_event, event, raw_body)
        except Exception:
            result, status = "storage_unavailable", 503
            raise HTTPException(status, "Event could not be saved") from None
        if result == "conflict":
            status = 409
            raise HTTPException(status, "Event ID already has a different body")
        status = 200 if result == "duplicate" else 202
        if result == "accepted":
            background.add_task(process_one, event.event_id, "immediate")
        response.status_code = status
        return {"status": result}
    finally:
        emit("webhook", result, started, status_code=status,
             level=logging.WARNING if status >= 400 else logging.INFO,
             event_id=event.event_id if event else None, event_type=event.event_type if event else None,
             account_id=event.account_id if event else None)
