import asyncio
import logging
from time import perf_counter

from app.database import connect_db
from app.event_log import emit
from app.events import CallEvent
from app.metering import apply_event


def record_failure(event_id: str, error: Exception) -> tuple[int, str] | None:
    # The billing transaction has rolled back. A concurrent success wins.
    with connect_db() as connection:
        return connection.execute(
            """UPDATE webhook_events
               SET attempts = attempts + 1, last_error = %s,
                   status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END,
                   next_retry_at = CASE WHEN attempts + 1 < 5 THEN
                       clock_timestamp() + LEAST(300, power(2, attempts + 1)) * interval '1 second' END
               WHERE event_id = %s AND status = 'pending'
               RETURNING attempts, status""",
            (type(error).__name__[:100], event_id),
        ).fetchone()


def process_one(event_id: str, source: str) -> None:
    started = perf_counter()
    fields = {"event_id": event_id, "event_type": None, "account_id": None, "source": source}
    claimed = False
    try:
        with connect_db() as connection:
            row = connection.execute(
                """SELECT raw_body, event_type, account_id, attempts FROM webhook_events
                   WHERE event_id = %s AND status = 'pending'
                     AND (next_retry_at IS NULL OR next_retry_at <= statement_timestamp())
                   FOR UPDATE SKIP LOCKED""", (event_id,)
            ).fetchone()
            if row is None:
                return
            claimed = True
            body, kind, account, failures = row
            fields.update(event_type=kind, account_id=account, attempt=failures + 1)
            event = CallEvent.model_validate_json(body)
            apply_event(connection, event)
            connection.execute(
                """UPDATE webhook_events SET status='processed', processed_at=clock_timestamp(),
                       is_late = date_trunc('month', received_at AT TIME ZONE 'UTC')
                               > date_trunc('month', occurred_at AT TIME ZONE 'UTC'),
                       next_retry_at=NULL, last_error=NULL WHERE event_id=%s""", (event_id,)
            )
    except Exception as error:
        result = "storage_unavailable"
        if claimed:
            try:
                saved = record_failure(event_id, error)
                if saved:
                    fields["attempt"], result = saved
                else:
                    result = "already_handled"
            except Exception:
                result = "failure_metadata_unavailable"
        emit("processing", result, started, level=logging.WARNING if result == "pending" else logging.ERROR,
             error=type(error).__name__, **fields)
        return
    emit("processing", "processed", started, **fields)


def due_ids() -> list[tuple[str]]:
    # process_one claims each row when it is ready to process it.
    with connect_db() as connection:
        return connection.execute(
            """SELECT event_id FROM webhook_events WHERE status='pending'
               AND (next_retry_at IS NULL OR next_retry_at <= statement_timestamp())
               ORDER BY received_at, event_id LIMIT 50"""
        ).fetchall()


async def retry_job(stop: asyncio.Event) -> None:
    while not stop.is_set():
        started = perf_counter()
        try:
            for (event_id,) in await asyncio.to_thread(due_ids):
                if stop.is_set():
                    break
                await asyncio.to_thread(process_one, event_id, "retry_job")
        except Exception as error:
            emit("retry_poll", "unavailable", started, level=logging.ERROR, error=type(error).__name__)
        try:
            await asyncio.wait_for(stop.wait(), timeout=5)
        except TimeoutError:
            pass
