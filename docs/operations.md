# Configuration and deployment

## Local demo

`docker compose up --build` explicitly uses development mode and seeds the demo
account. The base Compose file is a local demo, not a production deployment.

For local live reload, use Node 22+, `npm ci`, a PostgreSQL database, and
`DATABASE_URL`/`JWT_SECRET` in `apps/api/.env`. Run `npm run db:generate`, then
`npm run db:migrate`, and `npm run dev`. The web dev origin defaults to
`http://localhost:5173`.

## Production

Use a fresh production database, not a demo database containing the publicly
known demo credentials. Existing real databases should be backed up and inspected
for demo accounts before deployment; disabling future seeding does not remove an
existing account.

The API image defaults to `NODE_ENV=production`. Configuration is validated before
migrations run and before the HTTP listener starts. Missing or placeholder values
fail startup and report only variable names. Demo seeding is prohibited.

Supply all of these through the deployment secret store:

- `POSTGRES_PASSWORD`: strong, random, URL-safe database password for Compose.
- `DATABASE_URL`: PostgreSQL URL with non-default password (constructed by Compose).
- `JWT_SECRET`: random secret, at least 32 characters; generate with `openssl rand -hex 32`.
- `APP_ORIGIN`: exact public HTTPS origin, with no path or trailing slash.
- `RESEND_API_KEY`, `EMAIL_FROM`: live API key and verified sending address.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`: private storage configuration.

Credentials have no production defaults. Validation checks configuration locally;
it does not verify provider access. Phase 1 sends invitations through Resend in production; storage behavior remains
for later phases. Development prints invitation links to the local API console. Do not commit secrets or dump them in command logs.

Use Docker Compose 2.24.4+ (`!override` support):

```sh
docker compose -f docker-compose.yml -f docker-compose.production.yml up --build -d
```

Terminate HTTPS with a reverse proxy on this host, forwarding to
`127.0.0.1:8080` (or `APP_PORT`). The production override binds the web port to
loopback; neither the API nor database publishes a host port. Restrict host access.
The startup command validates configuration, applies committed migrations, and
starts the API. It does not seed production accounts. Never use `migrate reset`
on a persistent database.

See [backup and restore](backup-restore.md) before upgrading an existing database.
