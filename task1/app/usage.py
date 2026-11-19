import hmac
import os
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query
from psycopg import Error
from psycopg.rows import dict_row

from app.database import connect_db


router = APIRouter()


@router.get("/usage/{account_id}")
def get_usage(account_id: str, month: Annotated[str, Query(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")],
              x_api_key: Annotated[str | None, Header()] = None):
    if not x_api_key or not hmac.compare_digest(x_api_key.encode(), os.environ["USAGE_API_KEY"].encode()):
        raise HTTPException(401, "Invalid API key")
    try:
        first_day = date.fromisoformat(f"{month}-01")
    except ValueError:
        raise HTTPException(422, "Invalid month") from None
    try:
        with connect_db() as connection, connection.cursor(row_factory=dict_row) as cursor:
            row = cursor.execute(
                """SELECT account_id, month, call_seconds, cost_cents, billed_calls, cap_exceeded_at
                   FROM monthly_usage WHERE account_id = %s AND month = %s""",
                (account_id, first_day),
            ).fetchone()
    except Error:
        raise HTTPException(503, "Database unavailable") from None
    if row is None:
        raise HTTPException(404, "No usage for this account and month")
    return row
