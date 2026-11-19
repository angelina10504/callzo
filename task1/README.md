# Task 1 — Usage Metering Service

## Current status

A minimal FastAPI API and Docker Compose setup for Postgres are implemented.
`GET /health` returns HTTP 200 with `{"status":"ok"}`.
This checks that the API responds; it does not connect to the database.
Compose checks Postgres separately.
`GET /ready` connects from the API to Postgres and executes `SELECT 1`.
It returns HTTP 200 with `{"status":"ready"}` on success, or HTTP 503
with `{"detail":"Database unavailable"}` for database connection failures.
The API creates its schema at startup. A valid new webhook commits its exact
bytes as `pending` and returns 202. After the response, the API tries billing
in a second transaction. A periodic retry job also processes due pending
rows. Identical deliveries return 200. A valid different body reusing the ID
returns 409 and logs a warning.

`GET /metrics` is public. `events_by_status` counts pending, processed and
failed events. `waiting_for_retry` counts pending events with at least one
recorded failure, including those still in backoff. If Postgres is unavailable
the metrics endpoint returns 503. Webhook and processing outcomes are JSON
lines with the event identifiers, result and elapsed milliseconds. A webhook
line also includes its HTTP status. Unvalidated requests have null identifiers.
Processing logs include the attempt number and source. Errors record the
exception class. Bodies, signatures, API keys and exception messages are omitted.

`GET /usage/{account_id}?month=YYYY-MM` returns the UTC month, billed seconds,
cost in cents, billed call count, and the time the soft cap was first exceeded.
Pass the usage API key in `X-API-Key`. An account/month with no usage returns 404.

Verification on 13 November 2026: Compose configuration validation passed;
Postgres started, became healthy, and returned `1` for `SELECT 1`.
Angelina subsequently verified the API from her Mac using
`curl -i http://localhost:8000/health`: it returned HTTP 200 with
`{"status":"ok"}`. The minimal API and Postgres setup is verified.

Verification on 18 November 2026: the rebuilt API connected to Postgres and
`SELECT 1` returned `1`. `/health` and `/ready` returned HTTP 200. With Postgres
stopped, `/health` remained HTTP 200 and `/ready` returned HTTP 503 with the
fixed error message above. After restarting Postgres, `/ready` returned HTTP
200 again. Both services were left running after these live smoke checks.

Event storage smoke check on 18 November 2026 used an isolated Postgres
instance while Docker Desktop was unresponsive. FastAPI created the table
and indexes at startup. The sample from `Task1_spec.md` came back with all
256 body bytes intact and status `pending`. Inserting the same ID with
`ON CONFLICT (event_id) DO NOTHING` left one row. Deleting that sample left
zero matching rows. A second startup succeeded against the same database.

Compose verification on 20 November 2026 confirmed that `webhook_events`
exists and both health endpoints return 200 after rebuilding. The webhook
smoke check used `scripts/send_event.py` and got 202 for a new event, 200
for its duplicate, 409 for different bytes under the same ID, 401 for bad
or missing signatures, and 422 for invalid signed bodies. Postgres held
only the valid test event as `pending`, with its exact bytes intact. A
database outage returned 503. After Postgres restarted, the test row was
deleted and the original row count was restored.

On 20 November 2026 the published Callzo simulator sent 184 HTTP requests
across seven separate runs. The counts below match the API access logs.
Rows added are the change in the Postgres row count during each run.

| Scenario | Requests sent | HTTP responses | Rows added |
| --- | ---: | --- | ---: |
| normal | 40 | 202 × 40 | 40 |
| duplicates | 25 | 202 × 10, 200 × 15 | 10 |
| out_of_order | 20 | 202 × 20 | 20 |
| late | 8 | 202 × 8 | 8 |
| malformed | 5 | 422 × 5 | 0 |
| bad_signature | 6 | 401 × 6 | 0 |
| cap_burst | 80 | 202 × 80 | 80 |
| **Total** | **184** | **202 × 158, 200 × 15, 422 × 5, 401 × 6** | **158** |

The 158 rows above were pending under the earlier ingestion-only version.
On upgrade, startup processed all 158 in receipt order. An independent SQL
sum of the first end per call matched all 16 account/month rows: 88 billed
calls, 36,675 seconds, and 1,226 cents.

| Retained scenario | Verified processing result |
| --- | --- |
| duplicates | 25 deliveries yielded 10 billed calls. Replaying all 25 original signed bodies returned 200 every time and left every monthly row identical. |
| out_of_order | All 10 ends arrived before their starts. Each call was billed once and later acquired its start time. |
| late | All 8 events were flagged late. Their 8 calls were billed to October 2026 although they arrived in November. |
| cap_burst | The 40 burst calls added 800 cents to the 52 cents already recorded for `acct_001` in November. The demo cap is 426 cents, half of 852. Burst call 19 (`call_1d1e76fea08d`) took the month from 412 to 432 cents and set the cap timestamp. All 40 calls counted. |

A fresh simulator invocation of `duplicates` generated 10 new calls and 16
repeat deliveries. Only those 10 new calls added usage. The database then
held 168 processed events and 98 billed calls, totaling 38,362 seconds and
1,284 cents. The independent comparison again reported zero differences.

The latest full simulator run against the two-transaction design produced
158 accepted responses, 15 duplicates, 5 validation errors and 6 signature
errors. After processing, the retained database held 326 processed events,
zero pending and zero failed. Both the independent SQL check and reconciliation
reported zero differences.

## Run this step

From the project root, run the following to start the API, Postgres and the
simulator with local demo credentials. A fresh reviewer checkout can use
the Compose defaults directly.

```bash
cd task1
docker compose up
```

To start only the API and Postgres and inspect usage:

```bash
docker compose up --build -d --wait api
curl -i http://localhost:8000/health
curl -i http://localhost:8000/ready
curl -i http://localhost:8000/metrics
curl -H 'X-API-Key: callzo_demo_usage_key' 'http://localhost:8000/usage/acct_001?month=2026-11'
```

The last command uses the demo key and an example billing month. Change
the month to match your simulator run. To override demo settings, copy
`.env.example` to `.env` and set the desired values. Keep the original
database credentials when reusing an initialized volume. The Compose
defaults for the signing secret, database password, and usage key are
public local-demo values.

To send real traffic for one scenario, run the following from `task1`.
Replace `normal` with any scenario in the table above. Each run can add rows.

```bash
docker compose run --rm simulator --url http://api:8000/webhooks/calls --scenario normal
```

Starting the whole stack with `docker compose up` runs the simulator with
`--scenario all`. Compose waits for the API's `/health` check first. The
simulator takes its signing secret through the `--secret` flag. Its entrypoint
passes the value from `WEBHOOK_SECRET` in the local environment file, even
when the scenario command is overridden.

Stop the containers with `docker compose down`. The named volume keeps
Postgres data between runs. Changing `.env` credentials after the first run
does not change credentials in an already initialized database.

To try the webhook, save a valid call event (for example, the JSON in the supplied webhook spec) as
`/tmp/callzo-event.json`. Run the following from `task1`. The first line
uses the same signing secret as the running API, including any local override.

```bash
export WEBHOOK_SECRET="$(docker compose exec -T api printenv WEBHOOK_SECRET)"
python3 scripts/send_event.py /tmp/callzo-event.json
python3 scripts/send_event.py /tmp/callzo-event.json
python3 scripts/send_event.py /tmp/callzo-event.json --signature wrong
python3 scripts/send_event.py /tmp/callzo-event.json --signature missing
```

For a fresh event ID, these requests return 202, 200, 401, and 401. The
sender reads the file as bytes, so changes to JSON spacing or the trailing
newline change the signed body. Use a fresh ID to run the example again.

## What the files do

- `app/main.py`: imports `FastAPI`, creates the application, and registers
  `health` for GET requests to `/health`. `-> dict[str, str]` describes a
  dictionary with string keys and values; FastAPI returns it as JSON.
  FastAPI's `lifespan` function calls `initialize_schema()` before `yield`,
  so the schema is in place before the API serves requests. If setup fails,
  startup fails and the error appears in the API logs.
  Startup also requires a nonempty `WEBHOOK_SECRET` and saves it in app state
  so the webhook route can use it. The router registers the POST endpoint.
  `/ready` calls `connect_db()` and executes `SELECT 1`, a query that needs
  no tables. `with` closes the connection when the block finishes, including
  on errors. `except OperationalError` catches database connection/operation
  failures; `HTTPException` returns a controlled 503 with a fixed message.
  `from None` suppresses the original exception context; credentials and
  database error details are not included in the HTTP response. Success
  returns `{"status":"ready"}`. Plain `def` allows FastAPI to run these
  blocking database calls in a thread.
- `app/database.py`: `os` reads environment variables; `psycopg` is the
  Postgres driver. `connect_db()` returns a new `psycopg.Connection`.
  Each `os.environ["NAME"]` reads required configuration; a missing variable
  raises an error. `dbname`, `user`, and `password` identify the database
  and its credentials. `host` comes from Compose's `POSTGRES_HOST=db`;
  Psycopg uses the default Postgres port, 5432. `connect_timeout=3` limits
  waiting to establish a connection to 3 seconds; it is not a query timeout.
  Passing credentials as separate arguments avoids constructing a URL that
  needs special characters escaped. The readiness check opens one connection
  per request; `with` in the route closes it after the query.
  `initialize_schema()` reads `schema.sql` from the same folder and runs it
  in a database transaction. The connection block commits on success and
  rolls back on error.
- `app/schema.sql`: defines `webhook_events`. The primary key allows one row
  per `event_id`. `BYTEA` preserves the exact request bytes, and `BIGINT`
  stores cost as whole cents. `occurred_at` is the event's timestamp and
  `received_at` defaults to the database transaction's start time. Rows start as
  `pending`. The indexes support finding pending events in receipt time
  order and looking up events for a call. `IF NOT EXISTS` lets the API apply
  this initial schema on new and existing volumes. Later changes to columns
  or constraints need a migration. Startup uses `ADD COLUMN IF NOT EXISTS`
  to add lateness and processing timestamps to existing event tables.
  `calls` keeps one row per call ID and `monthly_usage` keeps one row per account/month.
- `app/events.py` defines the validated call event used by ingestion and replay.
- `app/webhooks.py` verifies the signature, validates the body, and commits
  the pending row. A new event schedules one immediate processing attempt.
- `app/processing.py` claims a due event under a row lock. It calls the billing
  function and marks success in the same transaction. Its asyncio job polls
  for up to 50 IDs in receipt order and uses the same processing function.
- `app/metering.py` updates the call and monthly usage using the caller's
  connection. The call that crosses the cap is recorded with its timestamp.
- `app/reconcile.py` replays processed raw bodies into temporary tables using
  that same billing function, compares both tables and optionally repairs them.
- `app/event_log.py` emits one JSON object per application log line.
- `app/usage.py` checks the API key and reads one monthly usage row.
- `scripts/send_event.py`: reads a file, signs its bytes with `WEBHOOK_SECRET`,
  posts them, and prints the HTTP status and response body. It uses only
  Python's standard library and can send a wrong or missing signature.
- `requirements.txt`: pins FastAPI (the API framework) and Uvicorn (the
  server that accepts HTTP requests), plus Psycopg (the Postgres driver).
  Psycopg's `[binary]` extra installs precompiled components, so the image
  does not need a compiler or a separate Postgres client library installation.
  Their dependencies are resolved by pip.
- `Dockerfile`: `FROM` supplies Python; `WORKDIR` sets the container's working
  folder. The first `COPY` and `RUN` install dependencies; the second `COPY`
  adds application code. `--no-cache-dir` avoids keeping pip's download cache
  in the image; `--timeout 60` allows up to 60 seconds for a network read.
  `CMD` runs Uvicorn: `app.main:app` means the `app`
  object in `app/main.py`. `0.0.0.0` listens on all container interfaces so
  Docker can forward port 8000 to it. Dependencies precede code so Docker
  can reuse the install layer when only application code changes.
- `.dockerignore`: keeps local secrets, virtual environments, Python caches,
  editor metadata, and tests out of the Docker build context.
- `docker-compose.yml`: `services` defines the API, Postgres, and simulator. `build: .`
  builds the API from this folder. `ports` exposes it only on your Mac's
  loopback address (host port 8000 forwards to container port 8000);
  `depends_on` waits for a healthy database at startup.
  The Postgres `image` supplies the database; `environment` configures its
  initial user, database, and password. The API's `environment` receives the
  same credentials, uses `db` as its database hostname, and receives the
  webhook secret from the local environment file.
  `${NAME:-callzo}` supplies a default;
  the same syntax supplies the demo defaults for credentials and the cap.
  `volumes` attaches persistent storage, declared at the bottom of the file.
  The health check runs `pg_isready` to check whether Postgres accepts
  connections. It uses a shell every 5 seconds, allows
  3 seconds per check and 10 failures, with a 5-second startup grace period.
  `$$` lets the container's shell expand its variables instead of Compose.

Postgres has no published host port. The API reaches it as `db:5432`
over Compose's network. Startup ordering does
not monitor or restart the API if Postgres later becomes unavailable.
`/health` still responds while Postgres is down; `/ready` reports the database
failure. Neither endpoint requires credentials from the caller or returns
database credentials.

Reference: [Psycopg connection and context manager documentation](https://www.psycopg.org/psycopg3/docs/basic/usage.html).

## Structure

- `app/`: Python application code.
- `scripts/`: manual tools for exercising the API.
- `tests/`: automated tests, including database correctness tests.
- `.env.example`: configuration variable names; secret values are left blank.
- `Dockerfile`, `docker-compose.yml`, `.dockerignore`: local container setup.
- `requirements.txt`: Python dependencies installed in the API image.
- `README.md`: setup, design decisions, failure behaviour, and next steps.

## Design decisions

These are implementation decisions for the assessment, not clarifications
confirmed by Callzo. The supplied webhook contract is in `../Task1_spec.md`.

| Requirement or ambiguity | Decision |
| --- | --- |
| Late events and billing months | Attribute usage to the calendar month of the event timestamp in UTC. Also flag an event as late when it is received after that month has ended. Historical totals can therefore change. |
| Billable events | Only `call.ended` adds duration and cost. Count it even if its start has not arrived. Started and failed events add no usage. |
| Monthly cap | A soft cap on cost, configured with `MONTHLY_CAP_CENTS`. Count the crossing event in full. Usage equal to the cap has not exceeded it; the first update taking usage strictly above it sets `cap_exceeded_at`. Keep counting subsequent events. |
| Concurrent usage updates | Lock the account/month usage row with `SELECT ... FOR UPDATE` while processing an event. Create that row safely if absent. The lock serializes updates and makes setting the first crossing consistent; a soft cap still allows usage above the limit. |
| Repeated event ID | Identical raw bytes with the same `event_id` return HTTP 200. Different bytes with the same ID return HTTP 409 and produce a warning. The original row is preserved. |
| Several end events for one call | The first end to acquire the call lock and commit wins. It stores its event ID and billing details. Another end flags the call for review. A later start can fill in the start time. A call ID reused across accounts is also flagged and keeps its original owner. |
| Usage API authentication | Require the configured `USAGE_API_KEY` in `X-API-Key` and compare it in constant time. Compose supplies a public key for local demos. |
| Acceptance | Commit the raw event as pending before sending 202. Duplicate deliveries do not reset a pending or failed event. |
| Processing | The immediate attempt and periodic job both lock a due pending row with `FOR UPDATE SKIP LOCKED`. Call updates, usage, lateness and the processed marker commit together. A crash releases the lock on rollback. |
| Retry scheduling | One asyncio task per API process polls at startup and five seconds after each batch. It selects up to 50 eligible IDs ordered by receipt time and ID. Each attempt takes its own lock and rechecks eligibility. Shutdown signals the task to finish its current attempt. |
| Reconciliation | Replay processed raw bodies in processing-time order, with receipt time and ID as tie-breakers. Temporary tables use the same billing code and current cap. The command locks the event ledger and derived tables while comparing or applying repairs, so ingestion and billing can briefly wait. Ordinary usage reads continue. |
| Strict validation | Require all contract fields, timezone-aware timestamps, supported event types, and nonnegative integer duration and cost. Reject strings, floats, and booleans for integer fields. Started and failed events must have zero duration and cost. Malformed input returns a 4xx response. |
| Signature verification order | Read the raw body bytes, verify their HMAC-SHA256 using `hmac.compare_digest`, then parse JSON. Missing or invalid signatures return HTTP 401 before JSON parsing or storage. |
| Account IDs | Accept `acct_` followed by exactly three ASCII digits and create the account on first acceptance. This deliberately extends the simulator's documented `acct_001`–`acct_010` set. |

`cap_exceeded_at` records the time processing first detects a crossing.
Reconciliation preserves the stored timestamp if the crossing call ID agrees
and a timestamp exists. Otherwise it uses the replayed crossing event's
original `processed_at`. If usage stays within the cap, both fields are null.

## Failure behaviour

- Missing or invalid signatures return 401. Invalid signed input returns 422.
- An identical delivery returns 200. A valid different body with the same ID
  returns 409 and preserves the original row.
- If the acceptance transaction fails, return 503 so the sender can resend.
  Once the raw insert commits, processing failures leave the 202 valid.
- A billing failure rolls back its derived writes. A separate transaction
  increments `attempts` and stores the exception class in `last_error`.
  The next delay is `min(2^attempts, 300)` seconds. The first four failures
  schedule 2, 4, 8 and 16 seconds. The fifth marks the event failed, clears
  its schedule and emits an error log. Failed rows remain available to inspect.
- A database outage can also prevent recording a failure. The job logs the
  outage and resumes polling. The most recent committed event state governs
  the next attempt. On success the error and retry time clear, and the failure
  count remains for inspection.
- A second end event for an already billed call is processed and flags the
  call for review. Its original charge stands.

## Verification

From `task1`, with the API and Postgres running:

```bash
docker compose exec api python -m app.reconcile
docker compose exec api python -m app.reconcile --apply
docker compose exec -T db sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/check_usage.sql
docker compose run --rm --no-deps -v "$PWD/tests:/app/tests:ro" api sh -c 'pip install -q pytest httpx2 && python -m pytest -p no:cacheprovider -q'
```

The first command previews missing, extra or changed derived rows and prints
their stored and expected values. Review it before using `--apply`, which
inserts missing rows, updates differences and removes extra derived rows
in one transaction. The raw ledger is preserved. Replaying the full history
under locks is a deliberate trade-off for this assessment-sized dataset.

The live repair check changed the November cost for `acct_001` from 860 to
861 cents. Dry-run found one difference. Apply restored 860 and preserved
the cap timestamp. The next dry-run found zero differences.

Seven pytest cases exercise billing, rollback, background recovery, exhaustion
after five failures, reconciliation and usage authentication. A test-only
monkeypatch fails billing after it has written usage. The HTTP request still
returns 202, the writes roll back and two failures accumulate. The background
job then succeeds on attempt three, leaving one billed call. Tests use a
private schema and roll back their own fixtures.

## Known limitation and next steps

The contract has no independently signed delivery timestamp or nonce. A valid
old request can be replayed. Persisted event IDs prevent duplicate usage for
previously accepted events, but do not establish freshness for unseen events.
The event timestamp is signed as part of the body, but represents when a call
event occurred, not when the sender delivered it. A future contract could add
a signed delivery timestamp and a replay window while still allowing late
call events.
