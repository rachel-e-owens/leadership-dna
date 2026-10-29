# Phase 1 acceptance — October 28, 2026

Acceptance criteria passed against a disposable PostgreSQL 16 database and real
API-backed Playwright browser sessions:

- A consultant creates and renames a group and invites two named members.
- Each member accepts a private, single-use invitation, sets a password, signs
  out, signs back in, and sees only their own empty forms/shared-reports dashboard.
- Members cannot retrieve a group, another membership's invitation status,
  consultant dashboard, raw report, or content library; inaccessible routes
  return 404. Consultant cross-account reads and mutations also return 404.
- Existing accounts must use a matching authenticated session to join. Acceptance
  preserves their password and account. Two concurrent accepts succeed only once.
- Used, expired, revoked, superseded, altered, and archive-invalidated tokens fail.
- Failed delivery revokes the token and preserves the member for a visible retry.
- Removing a member removes active membership access; archiving pauses access.
- Invitation activation is rate limited. Raw tokens appear in neither application
  HTTP logs nor browser API URLs; the UI submits them in request bodies.

Commands completed successfully:

- `npm run build` — API and web production builds.
- `npm test` — six API unit/security/provider tests and five web/editor tests.
  Five database-dependent tests skip without TEST_DATABASE_URL and all ran below.
- `npm run db:rehearse` — all five real API/browser tests passed with zero skips.
  The rehearsal first applied the three old migrations, inserted existing users,
  library/report/private-note/delivery data, then applied the new additive
  migration. It verified unchanged records and consultant access, dumped/restored
  all nine tables (including migration history), and verified exact equality.
- `git diff --check` — no whitespace errors.

Desktop group management and mobile member dashboard screenshots were inspected;
Playwright also checks mobile page width and absence of browser runtime errors.
Existing continuous report editor, content copies, formatting, saves/reopens,
private notes, and report ownership regression tests passed.

Disposable schemas/containers were cleaned up. The user's existing application
and production databases were not migrated. Back up and apply the new migration
before starting the updated app, as described in
[the workflow guide](groups-and-invitations.md). Deployment configuration was not
changed in Phase 1. Real email delivery was not exercised: tests use an injected
mailbox, and the Resend adapter was checked with a mocked HTTP response.
