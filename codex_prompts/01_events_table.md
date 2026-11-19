Next step for task1 only: create the Postgres table for incoming webhook events, and verify that one sample event can be saved and read back. Do NOT build the webhook endpoint, signature check, usage totals, or worker yet.

Requirements:
1. Table `webhook_events`:
   - `event_id TEXT PRIMARY KEY` (this is what makes duplicate deliveries harmless later)
   - `event_type TEXT NOT NULL` with a CHECK for `call.started`, `call.ended`, `call.failed`
   - `account_id TEXT NOT NULL`, `call_id TEXT NOT NULL`
   - `occurred_at TIMESTAMPTZ NOT NULL` (the event's own timestamp)
   - `duration_seconds INTEGER NOT NULL CHECK (>= 0)`, `cost_cents BIGINT NOT NULL CHECK (>= 0)`; integers only, no floats for money
   - `destination_country TEXT`
   - `raw_body BYTEA NOT NULL` (exact bytes received, so we can re-check signatures and replay later)
   - `received_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `status TEXT NOT NULL DEFAULT 'pending'` (pending / processed / failed), plus an index on `(status, received_at)`
   - an index on `call_id`
2. Schema creation: keep the SQL in a file such as `task1/app/schema.sql` and apply it with `CREATE TABLE IF NOT EXISTS` when the API starts. Do NOT rely on `/docker-entrypoint-initdb.d`, because our existing Postgres volume is already initialized and init scripts would not run.
3. Verification: rebuild with docker compose, then insert one sample event (use the example JSON from ../Task1_spec.md), read it back, insert the same `event_id` again with `ON CONFLICT (event_id) DO NOTHING`, and show that the row count is still 1. Delete the sample row afterwards.
4. Update task1/README.md "Current status" and explain each new file briefly, in plain language, as you did before.

Ask me before running any command that deletes Docker volumes or data other than the sample row.
