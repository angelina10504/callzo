# Task 2 — Usage Admin Console

The scaffold has one page. It fetches `/api/health` once and displays the mock API's status and account count. It uses JavaScript so the health check and build setup are easy to follow. React, React DOM, Tailwind CSS v4 and Recharts are the four direct runtime dependencies. Recharts is installed for the later summary chart.

## Run with Docker

From the repository root, with Docker running and ports 3000 and 8001 available:

```sh
cd task2
docker compose up --build -d
curl http://localhost:3000/api/health
```

Open <http://localhost:3000>. The page should read **Status: ok · Accounts: 10,500**. The curl response is `{"status":"ok","accounts":10500}`. Run `docker compose down` from this directory to stop Task 2.

Node builds the static files and nginx serves them. At container startup nginx substitutes `API_URL` into its configuration. It strips the `/api/` prefix and forwards the rest of the path and query string to the mock. The default upstream is `http://mock-api:8001` on the Compose network. Set `API_URL` to an origin without a trailing slash to override it. Compose builds the frontend locally for this stage. The submission requires a published frontend image.

## Run with Vite during development

From `task2`, use Node 22.12 or later in the Node 22 line and run:

```sh
docker compose up -d mock-api
npm ci
API_URL=http://localhost:8001 npm run dev
```

Open the URL Vite prints. Both servers expose the same `/api/` paths to the browser. Vite runs on the host here, so its upstream uses the mock's published port.

## API notes

These observations came from curl requests to the supplied image on port 8001.

| Endpoint | Observed response |
| --- | --- |
| `GET /health` | 200 with `{"status":"ok","accounts":10500}`. |
| `GET /accounts` | 200 with `{data, total, page, page_size}`. Each row has the same fields as account detail. Two consecutive requests for page 1 with 200 rows sorted by ID returned the same IDs in order. Usage changed on 8 rows. For ID 49, minutes went from 224 to 225, SMS from 90 to 92 and cost from 210792 to 210893 cents. |
| `GET /accounts/{id}` | 200 with one object containing `id, name, email, company, country, plan, status, signup_date, current_month_minutes, current_month_sms, cost_cents, last_active`. ID 99999 returned 404 with `{"detail":"account not found"}`. |
| `GET /accounts/summary` | Of 30 requests, 24 returned 200 and 6 returned 500 (20% in this sample). Success gives `{series, total_accounts}` with `date, minutes, sms, cost_cents, signups` per entry. Failure gives `{"detail":"temporary failure generating summary, try again"}`. |
| `GET /accounts/{id}/settings` | 200 with `{}` before any save. After saving, keys `"1"` through `"4"` hold each step's field values. |
| `PUT /accounts/{id}/settings/step/{step}` | Send `{"data":{...}}`. All four initial saves returned 200 with `{step, saved, data}`. Field errors return 422 with `{detail: {step, errors}}`. |
| `POST /accounts/{id}/settings/submit` | An empty draft returned 400 with `{"detail":{"error":"incomplete form","missing_steps":[1,2,3,4]}}`. A complete draft returned 200 with `{submitted: true, account_id, settings}`. |

**Step 2 reproduction.** On account `10500`, step 2 accepted `{"data":{"plan":"pro","billing_country":"GB"}}`. After saving step 4 with `webhook_url=https://example.com/callzo`, repeating the identical step 2 request returned 422 with `{"detail":{"step":2,"errors":{"billing_country":"billing_country is required"}}}`. Reading the draft still showed `GB`, and submitting all four saved steps succeeded.
