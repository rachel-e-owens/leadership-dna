# Leadership DNA Report Builder

An MVP scaffold for turning reusable Leadership DNA content into polished client reports. It includes an authenticated consultant workspace, client groups, reusable content blocks, a TipTap rich-text report editor, and an email-delivery queue endpoint.

## Stack

- React + TypeScript + Vite
- Express + TypeScript + Prisma
- PostgreSQL (Docker Compose included)
- TipTap rich-text editor
- JWT authentication (passwords hashed with bcrypt)

## Run locally

1. Copy `.env.example` values into `apps/api/.env` (database URL and JWT secret) and `apps/web/.env` (the Vite API URL).
2. Start Postgres: `docker compose up -d db`
3. Install dependencies: `npm install`
4. Generate Prisma client and apply the initial migration: `npm run db:generate` then `npm run db:migrate -- --name init`
5. Seed the sample account/content: `npm run prisma:seed -w @leadership-dna/api`
6. Start both apps: `npm run dev`

Open `http://localhost:5173`. The seeded login is `demo@leadershipdna.com` / `welcome123`.

## MVP boundaries

The send endpoint creates a durable `ReportDelivery` record and marks the report sent. Connect a transactional provider (Resend, Postmark, SES) inside `POST /api/reports/:id/send` to deliver actual emails and a hosted/downloadable PDF. The database schema is ready to retain delivery history; PDF rendering and a real provider are the next production integrations.
