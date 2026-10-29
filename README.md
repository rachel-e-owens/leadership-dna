# Leadership DNA Report Builder

An MVP scaffold for turning reusable Leadership DNA content into polished client reports. It includes an authenticated consultant workspace, reusable content blocks, a TipTap rich-text report editor with reports saved in the app.

## Stack

- React + TypeScript + Vite
- Express + TypeScript + Prisma
- PostgreSQL (Docker Compose included)
- TipTap rich-text editor
- JWT authentication (passwords hashed with bcrypt)

## Run the packaged app

With Docker Desktop running, start the entire application with one command:

```sh
docker compose up --build
```

Open `http://localhost:8080`. The stack starts PostgreSQL, applies committed Prisma migrations, starts the API, and serves the built web app. The seeded login is `demo@leadershipdna.com` / `welcome123`.

The database is kept in the `postgres_data` Docker volume, so your data remains after stopping the stack. Use `Ctrl-C` to stop it, then run `docker compose down` to remove the containers. To start it in the background, use `docker compose up --build -d`.

### Optional configuration

The defaults are ready for local demo use. Production requires explicit credentials and disables demo seeding; see [deployment configuration](docs/operations.md). To change the browser port, database password, or JWT secret, copy [`.env.example`](.env.example) to `.env`, update its values, and run the same command. `APP_PORT` defaults to `8080`.

### Local development without Docker

For live-reload development, install Node.js 22+, provide `DATABASE_URL` and `JWT_SECRET` in `apps/api/.env` and `VITE_API_URL=http://localhost:4000/api` in `apps/web/.env`, then run the existing database, Prisma, seed, and `npm run dev` commands as needed. The packaged Docker workflow above is the supported quick-start path.

## Continuous report editor

Open a report to edit its title, headings, paragraphs, lists, and formatting as one continuous document. Place the cursor anywhere and choose a content-library block to insert an independent copy. Editing or deleting the copy does not change the library original. Use the toolbar for selected-text formatting, alignment, and undo/redo; use the report styling controls for font, text size, color, and line spacing throughout the document.

**Save** stores the document and styling. The report name above the editor names the saved report; the heading inside the document is editable independently. Existing reports convert to a document when opened and persist that conversion on Save. Their original blocks, library links, and private facilitator notes are retained. Private notes remain editable in the panel below the document separately from the report document.

Apply the new additive migration before starting the updated API: `npx prisma migrate deploy` from `apps/api`, or rebuild with `docker compose up --build`, which applies migrations automatically. No report or library content is deleted by the migration.

## Tests

Run `npm test` to check conversion, independent block copies, input validation, and browser behavior (cursor insertion, formatting, undo/redo, save/reopen, and mobile layout). The browser tests use a local Vite server and a simulated API. Install their browser once with `npx playwright install chromium` (on Linux use `npx playwright install --with-deps chromium`). Playwright is only a web development dependency; the running app does not launch or install a browser.

To also run the real API/database persistence test, set `TEST_DATABASE_URL` to a disposable PostgreSQL database and run `npm run test -w @leadership-dna/api`. That test applies migrations in a unique temporary schema, exercises authenticated API requests, verifies preservation of original blocks and private notes, checks report ownership, and drops only its temporary schema afterward. Without `TEST_DATABASE_URL`, the database test is skipped.

## Groups and member invitations

Open **Groups** to manage engagements and invite members. Members accept a private
link, sign in, and see their own empty forms/report dashboard. See the
[Phase 1 workflow and migration guide](docs/groups-and-invitations.md) for email
setup, permissions, and acceptance tests.

## Historical groups archive

The `groups` Git branch preserves the app with client groups and group emailing. The current app preserves standalone reports; the new group membership workflow is described above. Historical delivery records remain in the database.

The removal migration drops group membership data and report-to-group associations while preserving reports and content blocks. Back up an existing database before applying migrations; switching Git branches does not restore database data.

## Foundation and operations

- [Current architecture and API protections](docs/architecture.md)
- [Local and production configuration](docs/operations.md)
- [Database backup, recovery, and disposable rehearsal](docs/backup-restore.md)

Run `npm run db:rehearse` with Docker available to verify migration deployment,
backup/restore integrity, and real API persistence and ownership isolation against
a disposable PostgreSQL 16 instance.
