# Application architecture

The browser is React/Vite with a TipTap report editor. Nginx serves the build and
proxies `/api` to Express. Prisma stores users, reusable content blocks, reports,
legacy report blocks/private notes, and historical deliveries in PostgreSQL.
The roadmap remains in [PRODUCT_BUILD_PLAN.md](../PRODUCT_BUILD_PLAN.md).

Authentication currently uses bcrypt and bearer JWTs. Phase 1 adds consultant/member
roles, private group invitations, and transactional email delivery. Reviewer roles, cookie sessions, reset flows, and storage adapters
belong to later phases. See [groups and invitations](groups-and-invitations.md).

Every existing report and library query uses `ownerScope()` or `ownedId()`.
These helpers throw if authentication did not establish an owner, preventing an
undefined Prisma filter from accidentally returning all tenants. Reports remain
creator-owned. Legacy report block references must also belong to that creator.
Private note writes remain restricted to blocks of the owned report.

Request logs are JSON with a generated request ID, method, route pattern, status,
and elapsed milliseconds. The same ID is returned as `X-Request-ID`. Raw URLs,
query strings, request/response bodies, authorization headers, error messages,
and stacks are excluded. The development email provider is an explicit local-mailbox
exception: it prints invitation links in development only, never in production.
Unexpected failures produce a generic JSON response
and a correlated `request_error` event. Validation and malformed JSON return 400;
oversized bodies return 413.

CORS accepts only `APP_ORIGIN` (development also supports legacy `WEB_ORIGIN`).
Requests without Origin remain available to API clients and health checks.
CORS is not authorization; bearer authentication and owner scopes enforce access.
All `/api/auth` requests share a 20-request/15-minute per-peer limit, including
future reset routes. It is in memory, resets on restart, and is intended for the
current single API process. Forwarded IP headers are deliberately not trusted.
With Nginx, requests share its peer address and therefore its limit. Before a
public pilot, configure a trusted proxy topology and a shared limiter if needed;
do not blindly enable Express `trust proxy` or trust arbitrary forwarding headers.
