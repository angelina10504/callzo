-- An empty result means every account/month agrees across all three totals.
WITH processed AS (
    SELECT *, first_value(account_id) OVER (
        PARTITION BY call_id ORDER BY processed_at, received_at, event_id
    ) AS owner_account
    FROM webhook_events WHERE status = 'processed'
), first_ends AS (
    SELECT DISTINCT ON (call_id) account_id, occurred_at, duration_seconds, cost_cents
    FROM processed
    WHERE event_type = 'call.ended' AND account_id = owner_account
    ORDER BY call_id, processed_at, received_at, event_id
), expected AS (
    SELECT account_id, date_trunc('month', occurred_at AT TIME ZONE 'UTC')::date AS month,
           sum(duration_seconds) AS call_seconds, sum(cost_cents) AS cost_cents, count(*) AS billed_calls
    FROM first_ends GROUP BY 1, 2
)
SELECT account_id, month, e.call_seconds AS expected_seconds, m.call_seconds AS stored_seconds,
       e.cost_cents AS expected_cost, m.cost_cents AS stored_cost,
       e.billed_calls AS expected_calls, m.billed_calls AS stored_calls
FROM expected e FULL JOIN monthly_usage m USING (account_id, month)
WHERE (e.call_seconds, e.cost_cents, e.billed_calls)
      IS DISTINCT FROM (m.call_seconds, m.cost_cents, m.billed_calls);
