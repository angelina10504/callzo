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
