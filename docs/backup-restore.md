# Database backups and restore rehearsal

Back up before every migration. Keep daily encrypted backups outside the database
host, with a proposed 30-day retention; verify the retention and recovery needs
with the operator before taking client data. Restrict access to operators. Dumps
contain password hashes, report text, and private notes. Never commit them, send
them to logs, or store them in a public bucket. The ignored `backups/` directory
is only staging, not an off-host backup strategy.

## Create a backup

From the deployed project (the commands below use the production Compose files):

```sh
umask 077
mkdir -p backups
docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T db \
  pg_dump -U postgres -d leadership_dna --format=custom --no-owner --no-acl \
  > "backups/leadership-dna-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Check the command exit code and archive readability (`pg_restore --list` using a
PostgreSQL 16 client). Encrypt and copy the successful archive to independent
private storage; verify its checksum after transfer. Set up an operator-owned
scheduler and alert on backup failures and missing daily archives. No automatic
remote backup is configured by this phase.

## Restore an actual backup

Use a separate PostgreSQL 16 instance, never the live database. Create an empty
database; restore with the PostgreSQL 16 client and a restricted `.pgpass` file:

```sh
createdb -h RESTORE_HOST -U RESTORE_USER leadership_dna_restore
pg_restore -h RESTORE_HOST -U RESTORE_USER -d leadership_dna_restore \
  --exit-on-error --no-owner --no-acl backups/SELECTED_BACKUP.dump
```

Point `DATABASE_URL` only at the restored instance, then run
`npx prisma migrate deploy --schema apps/api/prisma/schema.prisma` and
`npx prisma migrate status --schema apps/api/prisma/schema.prisma`.
Compare row counts and sample documents, styles, private notes, library blocks,
and delivery records against the source. Start an isolated app against the copy
and confirm login, report save/reopen, and cross-account access denial. Record
backup timestamp, checksum, duration, migration revision, and results. A successful
dump alone is not proof of recoverability.

For a real recovery, stop application writes, take a final backup if possible,
restore to a new database, verify it, switch the application connection, and only
then reopen access. Preserve the original database until recovery is accepted.
Old migration history includes destructive group removal; a code rollback cannot
restore dropped group membership data.

## Automated disposable rehearsal

With Docker running and dependencies installed:

```sh
npm run db:rehearse
```

This creates a randomly named PostgreSQL 16 container on an ephemeral loopback
port with a random password and no persistent volume. It first upgrades a
pre-Phase-1 database with existing records and verifies their preservation. It
then seeds synthetic group/member/invitation and report/private-note/delivery data,
dumps and restores into a second database, reapplies migrations, checks migration
status, and compares every row in all application and migration-history tables.
It then runs the real API persistence, group/invitation ownership, and Playwright
member acceptance tests against temporary schemas in the restored database. The container and dump are removed in `finally`.
It never reads the application's real `DATABASE_URL` or accepts a source database.

If forcibly interrupted, list `leadership-rehearsal-*` containers and remove only
the specific disposable container after confirming its name. Run this rehearsal
for migration changes and periodically exercise the actual off-host backup as
well. Synthetic data verifies the mechanism, not a particular production archive.
