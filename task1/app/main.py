import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from psycopg import OperationalError

from app.database import connect_db, initialize_schema
from app.metering import monthly_cap
from app.processing import retry_job
from app.usage import router as usage_router
from app.webhooks import router as webhook_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    secret = os.environ.get("WEBHOOK_SECRET", "")
    if not secret.strip():
        raise RuntimeError("WEBHOOK_SECRET must be set")
    app.state.webhook_secret = secret.encode("utf-8")
    monthly_cap()
    initialize_schema()
    stop = asyncio.Event()
    job = asyncio.create_task(retry_job(stop))
    try:
        yield
    finally:
        stop.set()
        await job


app = FastAPI(lifespan=lifespan)
app.include_router(webhook_router)
app.include_router(usage_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def ready() -> dict[str, str]:
    try:
        with connect_db() as connection:
            connection.execute("SELECT 1")
    except OperationalError:
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    return {"status": "ready"}


@app.get("/metrics")
def metrics():
    try:
        with connect_db() as connection:
            rows = connection.execute(
                """SELECT status, count(*), count(*) FILTER (WHERE attempts > 0)
                   FROM webhook_events GROUP BY status"""
            ).fetchall()
    except OperationalError:
        raise HTTPException(503, "Database unavailable") from None
    counts = {"pending": 0, "processed": 0, "failed": 0}
    waiting = 0
    for status, total, previously_failed in rows:
        counts[status] = total
        if status == "pending":
            waiting = previously_failed
    return {"events_by_status": counts, "waiting_for_retry": waiting}
