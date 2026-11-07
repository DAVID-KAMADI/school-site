# Institution Website Platform

Public website, admissions, student portal and admin CMS. The full specification is
`Institution_Website_System_Design_Blueprint.docx`.

| Part | Stack | Folder |
|---|---|---|
| Front end | Angular 22 + SSR | `frontend/` |
| API | Node.js + NestJS 12 + TypeORM | `backend/` |
| Database | MySQL 8 (local training database for now) | `database/` |

## First-time setup (local)

1. Create the training database and app user (asks for your MySQL root password):

   ```
   mysql -u root -p -h 127.0.0.1 -P 3309 < database/setup-local.sql
   ```

   `setup-local.sql` and `backend/.env` hold this machine's generated password and are
   git-ignored. On another machine, copy the `.example` files and choose a new password.

2. Start the API (http://localhost:3000/api/v1/health should report `"database": "up"`):

   ```
   cd backend
   npm run start:dev
   ```

3. Start the front end (http://localhost:4300; `/api` and `/media` are proxied to the API).
   Port 4300 is used because another project on this machine uses 4200.

   ```
   cd frontend
   npm start
   ```

4. Create your own super administrator (prints a one-time password):

   ```
   cd backend
   npm run create-admin -- --email you@example.ac.ke --name "Your Name"
   ```

   Then open http://localhost:4300/admin, sign in, and set up two-step login with an
   authenticator app (Google Authenticator, Microsoft Authenticator or similar).

## Demo content (visual reference)

```
cd backend
npm run seed:demo             # home, about us, academics, admissions, student life, contact us
npm run seed:demo -- --remove # take it all out again
```

The demo uses a fictional "Mwangaza College", sample numbers and sample student stories, with free
Unsplash photos credited in the media library. Everything is normal CMS content: edit or replace it
in /admin. Restart the API after seeding so its cache picks up the new content.

## What is built so far

- **Sign-in and permissions** (`backend/src/identity`): Argon2id passwords, HttpOnly session
  cookies with one active device per account, required two-step login for staff, lockout after
  repeated failures, CSRF protection, roles that can be limited to one section of the site, audit log.
- **Content API** (`backend/src/cms`): pages made of blocks, drafts and revisions, publish /
  schedule / approval workflow, trash, preview links, media library with automatic resizing,
  menus, site settings, editable interface text (English/Kiswahili), redirects.
- **Blog** (`backend/src/blog`): public articles at `/blog`, with staff drafting, rich-text editing,
  cover images from the media library, and publishing controlled by the existing CMS roles.
- **Front end** (`frontend/src/app`): server-rendered public site that draws every page from
  the database, and the admin portal at `/admin` (page and blog editors, media library,
  menus, settings, text, redirects, users, audit log).

### Blog

- Visitors can browse published stories at `/blog` and open an individual story from its card.
- Staff manage drafts and published posts under **Admin → Blog**. Editors with the existing
  `pages.create` and `pages.edit` permissions can write and save drafts; publishers with
  `pages.publish` can make them public or return them to drafts.
- Article content is sanitized on the API before it is stored, and drafts are never returned by
  the public blog API.
- Apply the blog database migration with `npm run migration:run` from `backend/` before using the
  blog on an existing installation.

## Languages

- Admin → Languages: add languages (Kiswahili, French, Arabic or any two-letter code). With two or more,
  visitors get a language button in the header. English is the main language and cannot be removed.
- Each language has its own addresses: `/fr/admissions` is the French version of `/admissions`.
  Top-level pages cannot use a language code as their address.
- Pages: open a page and choose the language at the top of the editor. A translation starts as a copy
  of the English page, is saved as a draft and published on its own. Until it is published, visitors see
  the English page with a short notice. The editor warns when the English page changed after the translation.
- Menu labels: Admin → Menus (one field per language). Buttons and messages: Interface text.
  Site name, tagline, address and banners: Admin → Languages.
- Removing a language hides it from visitors but keeps its translations.

## Timetable

- Admin → Timetable (role "Timetable officer", or super administrator).
- Set up once: rooms (seats and type, e.g. computer lab), lecturers (times they are not available, most
  periods a day), classes (students taught together, with their size) and units (and the room type they need).
- Each term: teaching days and periods (with tea and lunch breaks), then lessons: a unit, the class or
  classes (combined classes sit together), the lecturer, sessions per week and periods per session.
- "Fill empty slots automatically" builds the timetable; "Rebuild all" starts again but keeps locked sessions.
  Click a session to move it: free slots are green, and a blocked slot says why.
- Never broken, by hand or automatically: no room, lecturer or class booked twice at once; sessions only on
  teaching days and never across a break; the room is big enough and of the right type; the lecturer is
  available and within their daily limit. The `tt_slots` unique index blocks double bookings even when two
  people save at the same moment.
- Publish the term to show it at `/timetable` (by class, lecturer or room, printable, shareable links).
  Add `/timetable` to a menu under Admin → Menus.
- Demo data: `npm run seed:timetable-demo` (add) / `npm run seed:timetable-demo -- --remove` (training only).

## Admissions

- Applicants: `/apply` (create an account, 7-step form that saves as you go, documents, status page).
- Staff: `/admin/applications` (review, request information, offer or reject, confirm fees, export CSV)
  and `/admin/admissions-setup` (programmes, intakes, required documents).
- Fee amount, payment instructions, declaration and welcome text: Site settings → Admissions.
  Form wording and status explanations: Interface text (keys starting `apply.`).
- Offers: applicants download an offer letter (PDF) and accept or decline online before a deadline.
  Letter wording, deadline (days) and the student portal address: Site settings → Admissions / Student portal.
- The student portal is the institution's existing system; this site links to it.
- Email and SMS notifications are paused: applicants see all updates on their status page.
- M-Pesa STK Push is paused: applicants are told about the fee and can enter their M-Pesa code;
  staff confirm it by hand.
- Applicant documents are stored in `storage/private` and only served to the applicant and staff.

## Tests

```
cd backend
npm test            # unit tests
npm run test:e2e    # end-to-end tests against the local training database (cleans up after itself)
```

## Legal pages (Terms, Privacy, Data Processing Agreement)

```
cd backend
npm run seed:legal    # creates the three pages and the footer legal links (never overwrites edits)
```

- Pages: `/terms-of-service`, `/privacy-policy`, `/data-processing-agreement`. They are ordinary pages: edit them under Admin → Pages.
- Complete every `[bracketed]` placeholder: ODPC registration number, Data Protection Officer, hosting and backup providers, refund policy, retention periods. Then have an advocate review all three pages before launch.
- Applicants must tick the consent box to create an account. Each account records when they agreed and which version (`users.terms_accepted_at`, `users.terms_version`).
- After an important change to the Terms or Privacy Policy, update the date at the top of the page and Site settings → Legal → `legal.terms_version`.
- Add a provider to the Data Processing Agreement list, and sign the agreement with them, **before** it handles any personal data (hosting, backups, SMS, email, M-Pesa).

## Security

See [SECURITY.md](SECURITY.md) for what protects the site, test results and accepted risks.

## Backups

```
cd backend
npm run backup          # database + uploaded files -> backups/<date-time>/ (keeps the newest 14)
npm run backup:check    # restores the newest backup into a scratch database and checks it
```

`backup:check` needs a separate scratch database, created once as the MySQL root user:

```sql
CREATE DATABASE school_site_training_restore_check CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON school_site_training_restore_check.* TO 'school_app'@'localhost';
```

To restore for real (site stopped), load `database.sql.gz` into the database and unpack
`storage.tar.gz` into the backend folder:

```
gunzip -c database.sql.gz | mysql -h <host> -P <port> -u <user> -p <database>
tar -xzf storage.tar.gz -C <backend folder>
```

Copy backups to a second place (another server or cloud storage). A backup on the same disk is lost with the disk.

## Going live

The API will not start with `NODE_ENV=production` while any of these are unsafe.

**API (`backend/.env` on the server)**

- `NODE_ENV=production`
- `COOKIE_SECURE=true`
- `REQUIRE_STAFF_2FA=true`
- `TRUST_PROXY=1` (behind Nginx or a load balancer)
- `FRONTEND_ORIGIN=https://<real domain>`
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`: the hardened production database. Use a dedicated account, never `root`, with a password of 16+ characters.
- New random secrets. Never reuse the training ones:
  - `TOTP_ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
  - `PREVIEW_LINK_SECRET`: 32+ random characters
  - `WEBSITE_SERVER_SECRET`: 32+ random characters, set to the **same value** on the website server below. It lets the website server tell the API each visitor's real address, so rate limits and sign-in limits count per visitor instead of treating everyone as one.
- `TOTP_ISSUER=<Institution name>`

**Website server (`frontend`, run `node dist/frontend/server/server.mjs`)**

- `NODE_ENV=production`
- `PORT`
- `API_ORIGIN=http://127.0.0.1:3000` (where the API listens)
- `TRUST_PROXY=1`
- `WEBSITE_SERVER_SECRET`: the same value as in the API settings (the website server will not start in production without it)
- `NG_ALLOWED_HOSTS=<real domain>,www.<real domain>`
- `WEB_WORKERS=auto`: one page-rendering process per CPU core, minus one for the API. One process uses only one core and slows down past about 50 visitors at once. Leave it unset when running under PM2 cluster mode, which does the same.

**Server**

- HTTPS certificate on the domain.
- Only ports 80 and 443 open to the internet. The database is not reachable from outside.
- Nightly `npm run backup` with copies off the server, and a monthly `npm run backup:check`.
- Run `npm run migration:run` on every deploy, and `npm run seed:legal` once. Never load the demo seed (`seed:demo`) on production.
- Legal pages completed (no `[brackets]` left) and reviewed by an advocate. Institution registered with the ODPC.

## Database rules

- Every schema change is a migration: `npm run migration:generate -- src/database/migrations/<Name>`
  then `npm run migration:run` (in `backend/`). Automatic schema sync is off.
- The training database holds invented data only. Never load real applicant or student records.
- The production database is created later with the hardening rules in section 13 of the blueprint.
