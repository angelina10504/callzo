import asyncio
import hmac
import json
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from psycopg import OperationalError, sql

from fastapi.testclient import TestClient

from app import main, processing, usage, webhooks
from app.reconcile import reconcile
from app.database import connect_db
from app.events import CallEvent


@pytest.fixture
def db(monkeypatch):
    """Run the real schema and store_event in a private, rolled-back namespace."""
    connection = connect_db()
    try:
        schema = sql.Identifier("test_" + uuid4().hex)
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(schema))
        connection.execute(sql.SQL("SET LOCAL search_path TO {}").format(schema))
        connection.execute(Path("app/schema.sql").read_text())

        @contextmanager
        def test_connection():
            with connection.transaction():
                yield connection

        for module in (webhooks, processing, main, usage):
            monkeypatch.setattr(module, "connect_db", test_connection)
        monkeypatch.setenv("MONTHLY_CAP_CENTS", "100")
        yield connection
    finally:
        connection.rollback()
        connection.close()


def deliver(event_id, call_id, cost, kind="call.ended"):
    timestamp = datetime(2026, 11, 1, tzinfo=timezone.utc)
    if kind == "call.started":
        timestamp -= timedelta(seconds=60)
    event = CallEvent(event_id=event_id, call_id=call_id, account_id="acct_001",
                      event_type=kind, timestamp=timestamp.isoformat(),
                      duration_seconds=60 if kind == "call.ended" else 0,
                      cost_cents=cost, destination_country="US")
    result = webhooks.store_event(event, event.model_dump_json().encode())
    if result == "accepted":
        processing.process_one(event_id, "immediate")
    return result


def totals(db):
    return db.execute("SELECT call_seconds,cost_cents,billed_calls,cap_exceeded_at FROM monthly_usage").fetchone()


def test_exact_cap_then_one_cent_above(db):
    deliver("equal", "a", 100)
    assert totals(db) == (60, 100, 1, None)
    deliver("crossing", "b", 1)
    seconds, cost, calls, crossed = totals(db)
    assert (seconds, cost, calls) == (120, 101, 2)
    assert crossed is not None
    deliver("later", "c", 9)
    assert totals(db) == (180, 110, 3, crossed)


def test_second_end_flags_review_without_charging(db):
    deliver("first", "a", 7)
    deliver("second", "a", 99)
    assert db.execute("SELECT billed_event_id, cost_cents, needs_review FROM calls").fetchone() == ("first", 7, True)
    assert totals(db) == (60, 7, 1, None)
    assert db.execute("SELECT count(*) FROM webhook_events WHERE status='processed'").fetchone() == (2,)


def test_end_before_start_bills_once(db):
    deliver("end", "a", 7)
    assert deliver("end", "a", 7) == "duplicate"
    deliver("start", "a", 0, "call.started")
    assert db.execute("SELECT started_at < ended_at, billed_event_id FROM calls").fetchone() == (True, "end")
    assert totals(db) == (60, 7, 1, None)


def test_accepted_event_survives_failure_and_job_bills_once(db, monkeypatch):
    original = processing.apply_event

    def fail_after_billing(connection, event):
        original(connection, event)
        raise OperationalError("test failure after derived writes")

    monkeypatch.setattr(processing, "apply_event", fail_after_billing)
    monkeypatch.setattr(main.app.state, "webhook_secret", b"test", raising=False)
    client = TestClient(main.app)
    body = json.dumps(dict(event_id="retry", call_id="a", account_id="acct_001",
                           event_type="call.ended", timestamp="2026-11-01T00:00:00Z",
                           duration_seconds=60, cost_cents=7, destination_country="US")).encode()
    headers = {"X-Signature": hmac.digest(b"test", body, "sha256").hex()}
    response = client.post("/webhooks/calls", content=body, headers=headers)
    assert response.status_code == 202
    assert db.execute("SELECT status, attempts, last_error FROM webhook_events").fetchone() == (
        "pending", 1, "OperationalError")
    assert client.get("/metrics").json()["waiting_for_retry"] == 1
    assert totals(db) is None

    async def recover():
        stop = asyncio.Event()
        job = asyncio.create_task(processing.retry_job(stop))
        try:
            async with asyncio.timeout(20):
                while True:
                    await asyncio.sleep(0.1)
                    status, attempts = db.execute("SELECT status, attempts FROM webhook_events").fetchone()
                    if attempts == 2:
                        monkeypatch.setattr(processing, "apply_event", original)
                    if status == "processed":
                        assert attempts == 2
                        break
        finally:
            stop.set()
            await job

    asyncio.run(recover())
    assert client.post("/webhooks/calls", content=body, headers=headers).status_code == 200
    assert totals(db) == (60, 7, 1, None)
    assert client.get("/metrics").json()["waiting_for_retry"] == 0


def test_fifth_failure_stops_scheduling(db, monkeypatch):
    def fail(*args):
        raise ValueError("test")

    monkeypatch.setattr(processing, "apply_event", fail)
    deliver("end", "a", 9)
    for _ in range(4):
        db.execute("UPDATE webhook_events SET next_retry_at=NULL")
        processing.process_one("end", "retry_job")
    assert db.execute("SELECT status,attempts,next_retry_at FROM webhook_events").fetchone() == ("failed", 5, None)
    assert processing.due_ids() == []
    assert totals(db) is None


def test_reconcile_repairs_usage_and_calls(db):
    deliver("cross", "a", 101)
    before = totals(db)
    db.execute("UPDATE monthly_usage SET cost_cents=0")
    db.execute("UPDATE calls SET duration_seconds=0")
    assert reconcile(db) == 2
    assert totals(db)[1] == 0
    assert reconcile(db, apply=True) == 2
    assert totals(db) == before
    assert reconcile(db) == 0
    db.execute("UPDATE monthly_usage SET cap_crossed_call_id='wrong', cap_exceeded_at='2001-01-01'")
    assert reconcile(db, apply=True) == 1
    assert db.execute("""SELECT cap_crossed_call_id='a' AND cap_exceeded_at=processed_at
                         FROM monthly_usage CROSS JOIN webhook_events""").fetchone() == (True,)


def test_usage_requires_api_key(db, monkeypatch):
    monkeypatch.setenv("USAGE_API_KEY", "unit-test-key")
    deliver("end", "a", 9)
    client = TestClient(main.app)
    path = "/usage/acct_001?month=2026-11"
    assert client.get(path).status_code == 401
    assert client.get(path, headers={"X-API-Key": "wrong"}).status_code == 401
    response = client.get(path, headers={"X-API-Key": "unit-test-key"})
    assert response.status_code == 200
    assert response.json()["cost_cents"] == 9
