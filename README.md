# Callzo engineering assessment

## Task 1 — Usage metering service

FastAPI receives signed call events and records monthly usage in Postgres.

```sh
cd task1 && docker compose up
```

Verified `docker compose up` from a fresh GitHub clone on 20 November 2026. [Setup, simulator and verification](task1/README.md)

## Task 2 — Usage admin console

React displays account usage and edits account settings against the supplied mock API. Compose pulls the published frontend image.

```sh
cd task2 && docker compose up
```

Verified `docker compose up` from a fresh GitHub clone on 21 November 2026. Open <http://localhost:3000>. [Setup, assessment checklist and design notes](task2/README.md)
