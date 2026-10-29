# Groups and member accounts (Phase 1)

## Use the workflow

Sign in as a consultant and open **Groups**. Create an engagement with a name and
optional client name. Select it to rename it, invite members by name/email, or
archive it. The member table displays pending, expired, revoked, accepted/active,
and removed states. Resending invalidates previous links. Revoking cancels the
pending invitation. Removing a member immediately removes their active group
access. Re-adding the same email requires a new invitation and acceptance.

New invitees open their private link and set a password. Existing account holders
must sign in with the matching email; invitations never reset an existing
password. They can use “Use a different account” if another account is signed in.
Successful acceptance removes the raw token from browser history and opens the
member workspace. Members see only **My forms** and **My reports shared with me**,
which are empty until later phases implement assignments and report sharing.

Existing consultant accounts retain their workspaces when invited to a group.
They can open their private member workspace with **My forms & shared reports**.
New invitation-created accounts have the MEMBER role and cannot access consultant
APIs, navigation, groups, rosters, raw reports, or the content library. A member
can belong to multiple groups without gaining access to any roster.

Archiving pauses member access and revokes pending invitations. Restoring resumes
accepted memberships but does not revive revoked links; resend those explicitly.

## Email and invitation handling

`EmailProvider` separates delivery from invitation logic. In development/test,
`ConsoleEmailProvider` prints a `development_email` event with the recipient and
private link to the API console. This is a local development mailbox; never
forward it to a shared log service or use development mode for client data.

Production uses `ResendEmailProvider` with the already-required `RESEND_API_KEY`
and `EMAIL_FROM`. It sends plain-text mail using the
[Resend send-email API](https://resend.com/docs/api-reference/emails/send-email).
No service was provisioned and no real email was sent during implementation.
Provider calls have a timeout. A failed delivery revokes the token, returns a
safe error, and leaves the member visible so the consultant can resend.

Links use a URL fragment (`/#invite=...`) so the web server never receives the raw
token in its URL or referrer. The browser sends it in a POST body to fixed API paths, keeping it out of
reverse-proxy access logs too. HTTP logs
record route patterns only. Tokens contain 32 random bytes, are stored only as
SHA-256 hashes, expire after seven days, and are consumed once. Serializable
transactions coordinate acceptance, resends, revocation, removal, and archiving.
Invitation endpoints are rate limited and responses are not cached.

## Authorization and endpoints

Authentication reloads the account role from the database on every request.
`requireConsultantGroup()` scopes group operations by both group ID and current
consultant ID. Member loaders use `activeMemberScope()` (current user, ACTIVE
membership, ACTIVE group). Foreign objects and unavailable invites return 404.
Public invite inspection requires the unguessable token and exposes only the
group/display name and whether sign-in is needed; it exposes no roster or email.

- `GET /api/me` — current account, including role.
- `GET /api/me/dashboard` — own empty forms/reports and own active membership count.
- `GET/POST /api/groups` — consultant's groups / create group.
- `GET/PATCH /api/groups/:groupId` — scoped group and member status / rename or archive/restore.
- `POST /api/groups/:groupId/members` — add or re-invite a removed member; send invitation.
- `DELETE /api/groups/:groupId/members/:memberId` — remove membership.
- `POST/DELETE /api/groups/:groupId/members/:memberId/invitations` — resend/revoke.
- `POST /api/invitations/inspect` (token in body) — inspect a valid invitation.
- `POST /api/invitations/accept` (token in body) — set a new account's password or join with a matching session.

The existing bearer-session approach remains. Cookie sessions/password reset,
forms, and reviewer sharing are outside this phase.

## Migration and validation

Back up first, regenerate Prisma, and apply committed migrations:

```sh
npm run db:generate
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

The additive migration creates Group, GroupMember, InviteToken, enums, foreign
keys and scope indexes, and adds User.role with CONSULTANT as the default for
existing accounts. It preserves report/library/private-note/delivery data.
A case-insensitive unique email index prevents case-variant duplicate accounts.
If the old database contains such duplicates, migration intentionally fails;
an operator must resolve those accounts and their ownership before retrying.
Do not delete an account or its reports merely to make the index succeed.

`npm test` runs unit and existing mocked editor browser tests. For all Phase 1
API and browser acceptance tests, use Docker and run:

```sh
npm run db:rehearse
```

The rehearsal upgrades a pre-Phase-1 database containing existing reports,
checks preserved data and roles, tests full backup/restore equality, and runs
real API and Playwright tests in isolated schemas. Alternatively set
`TEST_DATABASE_URL` to a disposable PostgreSQL database when running `npm test`.
