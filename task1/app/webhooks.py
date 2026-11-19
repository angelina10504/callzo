import hmac
import json
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from psycopg import OperationalError
from starlette.concurrency import run_in_threadpool

from app.database import connect_db
from app.events import CallEvent
from app.metering import apply_event


router = APIRouter()
logger = logging.getLogger(__name__)


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
            apply_event(connection, event)
            return "accepted"

        existing = connection.execute(
            "SELECT raw_body FROM webhook_events WHERE event_id = %s", (event.event_id,)
        ).fetchone()
        if existing is None:
            raise OperationalError("Conflicting event disappeared before lookup")
        return "duplicate" if existing[0] == raw_body else "conflict"


@router.post("/webhooks/calls", status_code=202)
async def receive_call(request: Request, response: Response) -> dict[str, str]:
    raw_body = await request.body()
    signature = request.headers.get("X-Signature")
    if not signature_matches(raw_body, signature, request.app.state.webhook_secret):
        raise HTTPException(status_code=401, detail="Invalid signature")

    event = validate_event(raw_body)
    try:
        result = await run_in_threadpool(store_event, event, raw_body)
    except Exception as error:
        logger.error("Webhook transaction failed (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Event could not be saved") from None

    if result == "conflict":
        logger.warning("Webhook event ID conflict: event_id=%r", event.event_id[:100])
        raise HTTPException(status_code=409, detail="Event ID already has a different body")
    if result == "duplicate":
        response.status_code = 200
    return {"status": result}
