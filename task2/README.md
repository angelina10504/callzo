# Task 2 — Usage Admin Console

The accounts table uses React and Tailwind CSS v4. The mock API handles search, sorting, filters and pagination. Amounts use USD for display and remain integer cents in the data.

## Run with Docker

With Docker Compose running, network access to Docker Hub, and ports 3000 and 8001 free:

```sh
git clone https://github.com/angelina10504/callzo.git
cd callzo/task2
docker compose up -d
curl http://localhost:3000/api/health
```

Open <http://localhost:3000>. The initial view shows daily usage and 25 of the mock API's 10,500 accounts, ordered by ID. The curl response is `{"status":"ok","accounts":10500}`. Run `docker compose down` from this directory to stop Task 2.

Node builds the static files and nginx serves them. At container startup nginx substitutes `API_URL` into its configuration. It strips the `/api/` prefix and forwards the rest of the path and query string to the mock. The default upstream is `http://mock-api:8001` on the Compose network. Set `API_URL` to an origin without a trailing slash to override it. Compose pulls `angelinagupta/callzo-task2-frontend:latest`. Node is only needed for local development. For a clean-pull rehearsal on the same machine:

1. In the original `task2` directory run `docker compose down`, then `docker rmi angelinagupta/callzo-task2-frontend:latest` if the image is present.
2. In a separate shell and temporary folder, clone the repo as above. From the clone’s `task2`, run `export COMPOSE_PROJECT_NAME=callzo_review_$(date +%s)` and `docker compose up -d`.
3. Open the console, check the account rows and daily chart, then choose **Edit settings**. The mock occasionally returns 500 for the summary. Use its **Retry** button if needed.
4. In that temporary shell run `docker compose down -v` and remove the temporary clone. In the original shell run `docker compose up -d` from the original `task2`.

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

## Account settings

Use **Edit settings** beside a name. The URL keeps the account ID and step, so refreshing reopens the dialog and reloads the server draft. On a new draft, contact details and plan come from the account. Back and the step buttons let you revisit earlier steps. Escape or Close returns focus to the opener. Closing with local edits or a failed save offers **Keep editing** and **Discard**.

The reducer keeps confirmed data, editable values, field errors and save status separately for each step. A valid changed step saves after 800 ms of inactivity or immediately on leaving. One PUT per step runs at a time. Typing during a request keeps the newer input and queues a follow-up save. Retry resends the current draft. Refresh restores confirmed values; edits awaiting confirmation live in this tab.

## The step-2 behaviour

After step 4 is saved, the mock rejects further changes to step 2. If a fresh account opens directly on step 4, its webhook draft waits locally for the first confirmed Billing save. This keeps the first billing value recoverable even after an incomplete submit. The stepper marks Billing as needing attention even when another step is open. Billing shows the rejected draft beside the previously saved country. Reverting to the confirmed values sends no PUT. **Submit** uses the versions already on the server, so a rejected edit cannot block an otherwise complete submission. An incomplete submission opens the first missing step. [375 px settings dialog](screenshots/settings-375.png)

## Assessment checklist

- [x] Server-side search, sort, filters and paging — `Filters`, `AccountsTable` and `Pagination` update the URL, and `useAccounts` requests that page.
- [x] Stable selection across pages — `AccountsPage` stores account IDs in a Set.
- [x] Shared date range without navigation — `DateRange` updates the URL for both `useAccounts` and `useSummary`.
- [x] Four-step autosave and back navigation — `useSettingsForm` flushes valid edits on leaving a step. `Stepper` and `StepFields` show server errors on their owning step.
- [x] Table request states — `AccountsTable` shows skeletons or an empty result. `TableFeedback` provides Retry and identifies retained rows on failure.
- [x] Chart request states — `LazySummary`, `SummaryCard` and `useSummary` handle loading, an empty series, retryable errors and stale data. Chart failures stay in the card.
- [x] Settings load states — `SettingsDialog` shows loading and Retry. An empty server draft uses account defaults. If only one GET fails, the dialog identifies it and waits for both sources before enabling edits.
- [x] Settings save states and rollback — `SaveStatus` reports progress or Retry. Unchanged drafts skip the PUT. `formReducer` keeps confirmed values and local edits separately when one step fails.
- [x] Submit states — `StepEditor` shows submitting, success or a retryable error. An empty or incomplete submission marks missing steps and preserves the others.
- [x] Keyboard, labels and focus — native controls, labelled fields, table sort buttons, a chart data table, and dialog focus trapping, step focus and return to the opener.
- [x] 375 px layouts — `style.css` scopes scrolling to the table, Recharts resizes the chart, and `settings.css` makes the dialog full screen. Screenshots are linked above.
- [x] Stable periodic refresh — `useAccounts` merges by ID every 15 seconds and defers new ordering until Reload. Selection stays in React state.
- [x] Docker startup — `docker-compose.yml` runs the published frontend and supplied mock together.

## Where state lives

- **URL.** Search, filters, sort, page, page size, dates, settings account and step survive a refresh and can be shared.
- **Server.** Account records, daily summaries and confirmed settings drafts are authoritative across sessions.
- **React.** Selection, typed drafts, field errors, save status and pending row order belong to the current tab so background requests can preserve work in progress.

## What I cut and why

- No committed automated test suite. I exercised the flows in headless Chrome without adding a test runner to the project.
- No virtualised table. The API limits each page to 200 accounts.
- Selection resets on reload. A shared URL describes the view while selections belong to the person using the tab.
- No optimistic settings writes. A step becomes complete only when the server confirms its values.

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
