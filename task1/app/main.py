import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from psycopg import OperationalError

from app.database import connect_db, initialize_schema
from app.webhooks import router as webhook_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    secret = os.environ.get("WEBHOOK_SECRET", "")
    if not secret.strip():
        raise RuntimeError("WEBHOOK_SECRET must be set")
    app.state.webhook_secret = secret.encode("utf-8")
    initialize_schema()
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(webhook_router)


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
