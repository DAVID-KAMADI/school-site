# Load tests

Scripts that simulate visitors and applicants against a running copy of the site, and check afterwards that
every application was stored correctly. Synthetic data only: every account is `…@loadtest.invalid`.
Results (statistics, test accounts and their test passwords) go to `loadtest/results/`, which git ignores.

Never point these at the live site. Use a test machine or a staging copy.

## Setup

1. Build the website: `cd frontend && npx ng build --output-path <folder>`.
2. Start the API and the website server with the same `WEBSITE_SERVER_SECRET`, the website with `TRUST_PROXY=1`
   (each simulated visitor sends its own address, as Nginx would):

   ```sh
   cd backend && PORT=3100 WEBSITE_SERVER_SECRET=<secret> node dist/main.js
   cd <folder>/server && PORT=4400 API_ORIGIN=http://127.0.0.1:3100 TRUST_PROXY=1 WEBSITE_SERVER_SECRET=<secret> node server.mjs
   ```

3. In another terminal, record CPU, memory and database activity while a test runs:
   `node loadtest/monitor.mjs --out loadtest/results/monitor-<name>.csv`

## Tests

| Command | What it does |
| --- | --- |
| `node loadtest/run.mjs --profile steps --levels 1,10,25,50,100,150,200 --stage 90` | Mixed journeys (65% browsing, 30% applying, 5% returning), stepping up the number of users |
| `… --mix browse:100` | Browsing only (home page, courses, other pages) |
| `node loadtest/run.mjs --profile spike` | 10 → 50 → 100 → 150 → 10 users |
| `node loadtest/run.mjs --profile endurance --users 50 --duration 1200` | Steady load, reported in 2-minute windows |
| `node loadtest/run.mjs --profile submit-burst --users 100` | 100 complete applications submitted at the same moment (20% double-clicked) |
| `node loadtest/run.mjs --profile login-burst --users 100` | 100 sign-ins at the same moment |
| `node loadtest/run.mjs --profile upload-burst --users 50` | 50 photo uploads, then 50 PDF uploads, at the same moment |
| `node loadtest/race.mjs` | Duplicate requests: several tabs, double-clicked register, upload, submit and "start new" |
| `node loadtest/integrity.mjs loadtest/results/<run>.json` | Compares what applicants were told with the database |
| `node loadtest/seed-volume.mjs --count 10000` | Adds 10,000 synthetic applications, to test with a full season of data |
| `node loadtest/admin.mjs --name admin` | Times the admin screens (lists, searches, exports) with one and with ten admins |
| `node loadtest/admin-bulk.mjs --count 50` | Bulk staff work: uploads and deletes 50 media items (one by one, then 10 at a time), moves 100 seeded applications to "under review", and has two staff change the same application at once |

Options for `run.mjs`: `--think 0.3` (pauses at 30% of a real person's, so each simulated user is about 3× busier),
`--abandon 0.2`, `--double 0.1` (double-clicked Submit), `--slow 0.15` (users on a slow connection), `--name`.

## Admin test account

`admin.mjs` and `admin-bulk.mjs` need a staff account and a sign-in link, made with the project's own commands, saved as
`loadtest/results/admin-cred.json` (`{"email","password","key"}`). It sets up two-step sign-in itself on first use.
