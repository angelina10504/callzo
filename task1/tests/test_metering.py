from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from psycopg import OperationalError, sql

from app import webhooks
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

        monkeypatch.setattr(webhooks, "connect_db", test_connection)
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
    return webhooks.store_event(event, event.model_dump_json().encode())


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


def test_failure_after_applying_rolls_back_every_table(db, monkeypatch):
    original = webhooks.apply_event

    def fail(connection, event):
        original(connection, event)
        raise OperationalError("simulated failure before commit")

    monkeypatch.setattr(webhooks, "apply_event", fail)
    with pytest.raises(OperationalError):
        deliver("end", "a", 7)
    for table in ("webhook_events", "calls", "monthly_usage"):
        assert db.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table))).fetchone() == (0,)
