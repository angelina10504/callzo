First, finish the pending Compose check from the last step (docker compose up --build -d --wait, confirm webhook_events exists, /health and /ready return 200).

Then, task1 only: add `POST /webhooks/calls` that verifies the signature and stores the event as `pending`. Do NOT compute usage totals, caps, or add a worker yet.

Requirements, in this order inside the handler:
1. Read the raw body bytes first (`await request.body()`). Do not let FastAPI parse JSON before the signature check, so do not declare a Pydantic body parameter on the route.
2. Signature: `X-Signature` = hex HMAC-SHA256 of the raw bytes with `WEBHOOK_SECRET`. Compare with `hmac.compare_digest`. Missing or wrong -> 401, and nothing is parsed or stored. Read `WEBHOOK_SECRET` from the environment, pass it through docker-compose.yml from `.env`, and fail at startup if it is empty. Put the spec's secret in my local `.env` only, never in committed files.
3. Parse and validate only after the signature passes. Empty body, truncated JSON, missing fields, wrong types (e.g. "60" as a string for an int, use strict types), negative numbers, unknown `event_type`, or a timestamp without a timezone -> 422 with a short error message, and nothing is stored. The process must never crash or return 500 for bad input.
4. Insert with `INSERT ... ON CONFLICT (event_id) DO NOTHING`. New event -> 202 `{"status": "accepted"}`. Same `event_id` with identical raw bytes -> 200 `{"status": "duplicate"}`. Same `event_id` but different bytes -> 409 and log a warning; do not overwrite the stored row.
5. If the database is unavailable, return 503 so the sender retries. Never acknowledge an event that was not saved.
6. Keep the logic small and readable: a `webhooks.py` module for the route, separate small functions for signature check and validation.

Verification: write `task1/scripts/send_event.py` (standard library only) that signs a JSON payload and POSTs it. Use it to show: valid event -> 202; same event again -> 200 and still one row; wrong signature -> 401; missing header -> 401; empty body / truncated JSON / unknown event_type / string duration -> 422; and that the table contains only the valid rows. Then delete the test rows.

Update README "Current status" and explain each new file in plain language like before. Ask me before deleting any Docker volumes.
