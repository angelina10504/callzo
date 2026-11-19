import hmac
import json
import logging
from datetime import datetime, timezone
from typing import Literal, Self

from fastapi import APIRouter, HTTPException, Request, Response
from psycopg import OperationalError
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from starlette.concurrency import run_in_threadpool

from app.database import connect_db


router = APIRouter()
logger = logging.getLogger(__name__)


class CallEvent(BaseModel):
    model_config = ConfigDict(strict=True)

    event_id: str
    event_type: Literal["call.started", "call.ended", "call.failed"]
    account_id: str = Field(pattern=r"^acct_[0-9]{3}$")
    call_id: str
    timestamp: datetime
    duration_seconds: int = Field(ge=0, le=2**31 - 1)
    cost_cents: int = Field(ge=0, le=2**63 - 1)
    destination_country: str

    @field_validator("timestamp", mode="before")
    @classmethod
    def parse_timestamp(cls, value: object) -> datetime:
        if not isinstance(value, str):
            raise ValueError("Timestamp must be an ISO 8601 string")
        timestamp = datetime.fromisoformat(value)
        if timestamp.tzinfo is None:
            raise ValueError("Timestamp must include a timezone")
        return timestamp.astimezone(timezone.utc)

    @field_validator("event_id", "call_id", "destination_country")
    @classmethod
    def check_database_text(cls, value: str) -> str:
        if "\0" in value:
            raise ValueError("Text must not contain a null character")
        value.encode("utf-8")  # Reject lone surrogate characters from JSON escapes.
        return value

    @model_validator(mode="after")
    def check_nonbillable_event(self) -> Self:
        if self.event_type != "call.ended" and (self.duration_seconds or self.cost_cents):
            raise ValueError("Started and failed events require zero duration and cost")
        return self


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
async def receive_call(request: Request, response: Response) -> dict[str, str]:
    raw_body = await request.body()
    signature = request.headers.get("X-Signature")
    if not signature_matches(raw_body, signature, request.app.state.webhook_secret):
        raise HTTPException(status_code=401, detail="Invalid signature")

    event = validate_event(raw_body)
    try:
        result = await run_in_threadpool(store_event, event, raw_body)
    except OperationalError:
        raise HTTPException(status_code=503, detail="Database unavailable") from None

    if result == "conflict":
        logger.warning("Webhook event ID conflict: event_id=%r", event.event_id[:100])
        raise HTTPException(status_code=409, detail="Event ID already has a different body")
    if result == "duplicate":
        response.status_code = 200
    return {"status": result}
