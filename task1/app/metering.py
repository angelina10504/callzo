import os
from datetime import datetime

from psycopg import Connection

from app.events import CallEvent


def monthly_cap() -> int:
    cap = int(os.environ["MONTHLY_CAP_CENTS"])
    if cap < 0:
        raise ValueError("MONTHLY_CAP_CENTS must be nonnegative")
    return cap


def apply_event(connection: Connection, event: CallEvent, *, replay_time: datetime | None = None) -> None:
    """Update the derived tables. Reconciliation supplies the historical processing time."""
    month = event.timestamp.date().replace(day=1)  # CallEvent normalizes to UTC.
    key = (event.account_id, month)
    connection.execute(
        "INSERT INTO calls (call_id, account_id) VALUES (%s, %s) ON CONFLICT (call_id) DO NOTHING",
        (event.call_id, event.account_id),
    )
    account, billed_id = connection.execute(
        "SELECT account_id, billed_event_id FROM calls WHERE call_id = %s FOR UPDATE",
        (event.call_id,),
    ).fetchone()
    if account != event.account_id:
        connection.execute("UPDATE calls SET needs_review = true WHERE call_id = %s", (event.call_id,))
    elif event.event_type == "call.started":
        connection.execute("UPDATE calls SET started_at = LEAST(started_at, %s) WHERE call_id = %s",
                           (event.timestamp, event.call_id))
    elif event.event_type == "call.failed":
        connection.execute("UPDATE calls SET failed_at = LEAST(failed_at, %s) WHERE call_id = %s",
                           (event.timestamp, event.call_id))
    elif billed_id is None:
        connection.execute(
            """UPDATE calls SET ended_at = %s, duration_seconds = %s, cost_cents = %s,
                                billed_event_id = %s WHERE call_id = %s""",
            (event.timestamp, event.duration_seconds, event.cost_cents, event.event_id, event.call_id),
        )
        connection.execute(
            "INSERT INTO monthly_usage (account_id, month) VALUES (%s, %s) ON CONFLICT DO NOTHING", key
        )
        previous_cost, = connection.execute(
            "SELECT cost_cents FROM monthly_usage WHERE account_id = %s AND month = %s FOR UPDATE", key
        ).fetchone()
        new_cost = previous_cost + event.cost_cents
        crossing = previous_cost <= monthly_cap() < new_cost
        connection.execute(
            """UPDATE monthly_usage
               SET call_seconds = call_seconds + %s, cost_cents = %s, billed_calls = billed_calls + 1,
                   cap_exceeded_at = CASE WHEN %s AND cap_exceeded_at IS NULL
                                          THEN COALESCE(%s::timestamptz, statement_timestamp()) ELSE cap_exceeded_at END,
                   cap_crossed_call_id = CASE WHEN %s AND cap_exceeded_at IS NULL
                                              THEN %s ELSE cap_crossed_call_id END
               WHERE account_id = %s AND month = %s""",
            (event.duration_seconds, new_cost, crossing, replay_time, crossing, event.call_id, *key),
        )
    elif billed_id != event.event_id:
        connection.execute("UPDATE calls SET needs_review = true WHERE call_id = %s", (event.call_id,))
