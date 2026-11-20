# Task 2 — Usage Admin Console

The accounts table uses React and Tailwind CSS v4. The mock API handles search, sorting, filters and pagination. Amounts use USD for display and remain integer cents in the data.

## Run with Docker

From the repository root, with Docker running and ports 3000 and 8001 available:

```sh
cd task2
docker compose up --build -d
curl http://localhost:3000/api/health
```

Open <http://localhost:3000>. The initial view shows daily usage and 25 of the mock API's 10,500 accounts, ordered by ID. The curl response is `{"status":"ok","accounts":10500}`. Run `docker compose down` from this directory to stop Task 2.

Node builds the static files and nginx serves them. At container startup nginx substitutes `API_URL` into its configuration. It strips the `/api/` prefix and forwards the rest of the path and query string to the mock. The default upstream is `http://mock-api:8001` on the Compose network. Set `API_URL` to an origin without a trailing slash to override it. Compose builds the frontend locally for this stage. The submission requires a published frontend image.

## Run with Vite during development

From `task2`, use Node 22.12 or later in the Node 22 line and run:

```sh
docker compose up -d mock-api
npm ci
API_URL=http://localhost:8001 npm run dev
```

Open the URL Vite prints. Both servers expose the same `/api/` paths to the browser. Vite runs on the host here, so its upstream uses the mock's published port.

## Accounts table

- **View state.** The URL stores search, status, country, plan, sort column, direction, page and page size. Typing replaces the current history entry. Other view changes add an entry. Back, Forward and copied URLs restore the view.
- **Fetching.** Search waits 300 ms after the last edit. A view change cancels the previous request. While the next page loads, the table keeps its height and dims the previous rows. Retry uses the current filters. Nginx allows three seconds to connect to the mock so a stopped service produces an inline error promptly.
- **Selection.** React holds a set of account IDs for this tab. The header checkbox toggles the displayed page. Selection survives navigation and polling, and resets on a full browser reload.
- **Refresh.** Every 15 seconds the visible tab checks for new values when no request is in flight. Changed cells flash briefly. If the server sends a different order or page membership, the table holds its rows in place. **Reload** applies the latest server page.
- **Small screens.** Filters stack, and the table scrolls independently with the name column pinned. [375 px screenshot](screenshots/accounts-375.png)

## Date range and daily usage

**From** and **To** apply to both the accounts table and the daily usage summary. Either end can be open. Editing or clearing a date resets the table to page 1 and records the range in the URL. An invalid range pauses both requests and their timers until corrected. Search, status, country and plan apply only to the accounts table.

Choose minutes, SMS or USD cost to plot the daily series. The caption gives the total and the peak day. **Show data table** provides the exact daily values. The metric and table toggle are local display choices. [375 px chart screenshot](screenshots/summary-375.png)

The chart loads independently. An initial request, a date change or a manual retry gets one automatic retry after one second. A second failure shows **Retry** in the chart card. After a successful load, the visible tab polls every 15 seconds. A failed poll keeps the last successful chart and shows its update time.

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
