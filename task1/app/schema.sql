CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL CHECK (event_type IN ('call.started', 'call.ended', 'call.failed')),
    account_id TEXT NOT NULL,
    call_id TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
    cost_cents BIGINT NOT NULL CHECK (cost_cents >= 0),
    destination_country TEXT,
    raw_body BYTEA NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed'))
);

CREATE INDEX IF NOT EXISTS webhook_events_status_received_at_idx
    ON webhook_events (status, received_at);

CREATE INDEX IF NOT EXISTS webhook_events_call_id_idx
    ON webhook_events (call_id);

ALTER TABLE webhook_events
    ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS calls (
    call_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    cost_cents BIGINT NOT NULL DEFAULT 0,
    billed_event_id TEXT REFERENCES webhook_events(event_id),
    needs_review BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS monthly_usage (
    account_id TEXT NOT NULL,
    month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
    call_seconds BIGINT NOT NULL DEFAULT 0,
    cost_cents BIGINT NOT NULL DEFAULT 0,
    billed_calls INTEGER NOT NULL DEFAULT 0,
    cap_exceeded_at TIMESTAMPTZ,
    PRIMARY KEY (account_id, month)
);

ALTER TABLE webhook_events
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_error TEXT,
    ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

ALTER TABLE monthly_usage ADD COLUMN IF NOT EXISTS cap_crossed_call_id TEXT;

-- Older versions set the cap time just before marking the crossing event processed.
UPDATE monthly_usage AS m SET cap_crossed_call_id = (
    SELECT c.call_id FROM calls c JOIN webhook_events e ON e.event_id = c.billed_event_id
    WHERE c.account_id = m.account_id
      AND date_trunc('month', c.ended_at AT TIME ZONE 'UTC')::date = m.month
      AND e.processed_at >= m.cap_exceeded_at
    ORDER BY e.processed_at, e.event_id LIMIT 1
) WHERE cap_exceeded_at IS NOT NULL AND cap_crossed_call_id IS NULL;
