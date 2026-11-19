# Task 1 — Usage Metering Service

## Current status

A minimal FastAPI API and Docker Compose setup for Postgres are implemented.
`GET /health` returns HTTP 200 with `{"status":"ok"}`.
This checks that the API responds; it does not connect to the database.
Compose checks Postgres separately.
`GET /ready` connects from the API to Postgres and executes `SELECT 1`.
It returns HTTP 200 with `{"status":"ready"}` on success, or HTTP 503
with `{"detail":"Database unavailable"}` for database connection failures.
The API creates the `webhook_events` table and its indexes at startup.
`POST /webhooks/calls` verifies the signature, validates the JSON, and saves
new events as `pending`. A committed insert returns HTTP 202. Repeating the
same ID and exact body returns HTTP 200. Reusing the ID with different bytes
returns HTTP 409 and logs a warning. Usage queries, cap enforcement, workers,
and reconciliation are planned.

Verification on 13 November 2026: Compose configuration validation passed;
Postgres started, became healthy, and returned `1` for `SELECT 1`.
Angelina subsequently verified the API from her Mac using
`curl -i http://localhost:8000/health`: it returned HTTP 200 with
`{"status":"ok"}`. The minimal API and Postgres setup is verified.

Verification on 18 November 2026: the rebuilt API connected to Postgres and
`SELECT 1` returned `1`. `/health` and `/ready` returned HTTP 200. With Postgres
stopped, `/health` remained HTTP 200 and `/ready` returned HTTP 503 with the
fixed error message above. After restarting Postgres, `/ready` returned HTTP
200 again. Both services were left running. These were live smoke checks;
automated test files have not yet been added.

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

Each duplicate returned 200 after its first delivery returned 202. All 158
stored rows were retained as `pending`. No request returned 500. The
`cap_burst` result covers ingestion of the burst. Cap enforcement is planned.

## Run this step

One-time setup from the project root (skip copying if `.env` already exists):

```bash
cd task1
cp .env.example .env
```

Set a nonempty `POSTGRES_PASSWORD` and set `WEBHOOK_SECRET` to the shared
secret from `Task1_spec.md` in your local `.env`. Then run:

```bash
docker compose up --build -d --wait api
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://localhost:8000/health
curl -i http://localhost:8000/ready
docker compose ps
docker compose exec db psql -U callzo -d callzo -c 'SELECT 1;'
```

Expected: `/health` returns HTTP 200 with `{"status":"ok"}`; `/ready`
returns HTTP 200 with `{"status":"ready"}`; Postgres is marked healthy;
and SQL returns `1`. The SQL command assumes the example user/database names.
The first run downloads images and Python packages; no Docker Hub account
or image publishing is needed for this step.

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

To try the webhook, save the example JSON from `Task1_spec.md` as
`/tmp/callzo-event.json`. Run the following from `task1`. The first line
exports the plain `WEBHOOK_SECRET` value from your local `.env` without
printing it.

```bash
export WEBHOOK_SECRET="$(sed -n 's/^WEBHOOK_SECRET=//p' .env)"
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
  blocking database calls in a worker thread.
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
  or constraints will need a migration.
- `app/webhooks.py`: reads the body and verifies its signature before parsing
  JSON. The event model checks the field types and allowed values, including
  the database limits for integers. It converts the event timestamp to UTC.
  The insert keeps the exact body bytes and uses the table's `pending`
  default. If the ID exists, a second query fetches the original bytes to
  distinguish a duplicate from a conflict. The database work runs in a
  thread so it can wait for Postgres while the API handles other requests.
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
  `${NAME:?...}` stops startup if the password is missing or empty.
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

Add modules when their behaviour is implemented. Usage queries, event
processing, the retry worker, and reconciliation are planned.

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
| Several end events for one call | The first valid end event durably saved for an account/call counts. Persist receipt order; retries and reconciliation must use that same order. Later end events with different IDs are retained and flagged but add no usage. Worker scheduling must not change the winner. |
| Usage API authentication | Require an API key from an environment variable. Use a constant-time comparison and keep keys out of logs and source code. This is a simple assessment-level administrative credential. |
| Durable acceptance and retries | Verify the signature and validate the event, then save it as `pending` in a transaction. Return HTTP 202 only after that transaction commits. The planned worker will use recoverable leases and record failures with `attempts` and `next_retry_at`. |
| Processing transaction | Commit the usage update and successful processing status together. A worker crash must not leave an event marked processed without its usage, or cause a retry to count it again. A separate failure update records retry metadata after a processing rollback. |
| Reconciliation | Raw accepted events are the source of truth. Rebuild usage using the same month, first-end-event, and cap rules as normal processing. Correct differing totals transactionally and log the correction count. Coordinate with live processing using the same locks so repairs cannot double-count pending work. |
| Strict validation | Require all contract fields, timezone-aware timestamps, supported event types, and nonnegative integer duration and cost. Reject strings, floats, and booleans for integer fields. Started and failed events must have zero duration and cost. Malformed input returns a 4xx response. |
| Signature verification order | Read the raw body bytes, verify their HMAC-SHA256 using `hmac.compare_digest`, then parse JSON. Missing or invalid signatures return HTTP 401 before JSON parsing or storage. |
| Account IDs | Accept `acct_` followed by exactly three ASCII digits and create the account on first acceptance. This deliberately extends the simulator's documented `acct_001`–`acct_010` set. |

`cap_exceeded_at` records when processing first detects a crossing, in UTC.
Reconciliation must preserve it when that crossing remains valid. Details for
repairing a missing or invalid crossing timestamp will be specified alongside
the reconciliation implementation and tests.

The initial example cap is 1,000 cents. Verify it against the actual
`cap_burst` scenario and adjust the demo configuration if needed so the flag
appears partway through the burst. Money and usage totals use integers.

## Failure behaviour

- Missing or invalid signature: HTTP 401; do not parse or store the event.
- Valid signature with invalid JSON or fields: HTTP 422 and no new event row.
- Identical duplicate: HTTP 200; no second usage update, including while pending.
- Database unavailable during ingestion: HTTP 503 so the sender can retry.
- Processing fails after acceptance: keep the raw event and retry metadata;
  the worker retries temporary failures.
- Worker dies while processing: its lease expires and the event becomes
  eligible for recovery. Processing remains idempotent.
- Conflicting call end: retain and flag it for review; do not bill it again.

Retry delays, maximum attempts, lease recovery, and exhausted-event visibility
will be defined when the worker is implemented.

## Verification plan

Test signature checks before JSON parsing, strict validation, identical
duplicates, conflicting IDs, out-of-order calls, late events, concurrent usage
updates, the exact cap boundary, multiple end events, worker recovery, and
reconciliation repairs. Run each supplied simulator scenario against Postgres.
Provide structured logs and a health endpoint, and verify clean startup with
`docker compose up` before submission.

## Known limitation and next steps

The contract has no independently signed delivery timestamp or nonce. A valid
old request can be replayed. Persisted event IDs prevent duplicate usage for
previously accepted events, but do not establish freshness for unseen events.
The event timestamp is signed as part of the body, but represents when a call
event occurred, not when the sender delivered it. A future contract could add
a signed delivery timestamp and a replay window while still allowing late
call events.

Next implementation step, after review, is to decide how to process the
pending events into usage totals.
