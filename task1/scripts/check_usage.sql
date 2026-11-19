-- An empty result means every account/month agrees across all three totals.
WITH first_ends AS (
    SELECT DISTINCT ON (call_id) account_id, occurred_at, duration_seconds, cost_cents
    FROM webhook_events
    WHERE event_type = 'call.ended'
    ORDER BY call_id, received_at, event_id
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
