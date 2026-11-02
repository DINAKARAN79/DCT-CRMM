# DCT-CRM

Enterprise Multi-Tenant CRM with dynamic object management, role-based access control, and permission-based authorization.

## Tech Stack

- **Frontend:** Next.js 14 (App Router), shadcn/ui, TypeScript
- **Backend:** Express.js, TypeScript
- **Database:** PostgreSQL, Prisma ORM
- **Auth:** JWT (HTTP-only cookies)

## Features

- Multi-tenant architecture with Super Admin
- Dynamic Object Manager (create custom objects/fields at runtime)
- Role-based access control (RBAC) with profiles, permission sets, and direct permissions
- 100 granular permissions across 20 modules
- Standard Lead fields (27 fields with picklists)
- Dynamic forms, tables, and detail views
- CRM workflow engine with status transitions
- Audit logging and activity tracking

## Super Admin platform reporting

The independent platform reporting area is available at `/platform-reporting`
for authenticated Super Admin users. It uses dedicated `/api/super-admin/reporting`
endpoints and saved platform definitions; tenant dashboard and report settings
do not control or grant access to this data.

The registry is derived from the generated Prisma model metadata. It exposes
platform-wide `Tenant` and `Permission` data plus eligible models with a direct
`tenantId` ownership field. Sensitive/authentication models and fields, JSON and
binary fields, and models without a safely enforceable tenant owner are omitted.
Supported to-one relationships can be used as validated report filters; report
selection uses fields on the selected object, and grouping also supports the
validated tenant-name dimension for tenant-owned records.

Reports support all-tenant or selected-tenant scope, filters, AND/OR filter
groups, grouping, count/sum/average/min/max aggregates, sorting, pagination,
saved CRUD operations, and CSV export for raw-record reports. Dashboard
definitions are separate from tenant dashboards and contain reusable report
widgets with saved query definitions, scope, ordering, and size settings.
Tenant analytics currently compares per-company lead counts. Platform overview
booking values and approved CRM payment collections are shown separately and by
tenant currency; they are not combined into a single revenue figure.

Apply the additive platform reporting migration before using these APIs:

```bash
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
```

## Getting Started

```bash
# Install dependencies
npm install

# Set up database
cd packages/db
npx prisma db push
npx ts-node src/seed-super-admin.ts
npx ts-node src/seed.ts
npx ts-node src/seed-lead-fields.ts

# Start API server
cd apps/api
npm run dev

# Start Web server
cd apps/web
npm run dev
```

## Login Credentials

| Email                   | Password    | Role        |
| ----------------------- | ----------- | ----------- |
| superadmin@dctcrm.com   | password123 | Super Admin |
| admin@dctcrm.com        | password123 | Admin       |
| salesmanager@dctcrm.com | password123 | Manager     |
| priya@dctcrm.com        | password123 | Sales       |
| amit@dctcrm.com         | password123 | Sales       |
| neha@dctcrm.com         | password123 | Presales    |
| finance@dctcrm.com      | password123 | Finance     |

## Test Users

The profile seed command creates or reuses these local test users in the
`dct-re` tenant. The password is hashed in the database and is intended only
for local testing.

| Profile | Username | Password |
|---|---|---|
| Admin | admin.test1@dctcrm.com | DctTest@123 |
| Admin | admin.test2@dctcrm.com | DctTest@123 |
| Admin | admin.test3@dctcrm.com | DctTest@123 |
| Presales | presales.test1@dctcrm.com | DctTest@123 |
| Presales | presales.test2@dctcrm.com | DctTest@123 |
| Presales | presales.test3@dctcrm.com | DctTest@123 |
| SVC | svc.test1@dctcrm.com | DctTest@123 |
| SVC | svc.test2@dctcrm.com | DctTest@123 |
| SVC | svc.test3@dctcrm.com | DctTest@123 |
| Sales | sales.test1@dctcrm.com | DctTest@123 |
| Sales | sales.test2@dctcrm.com | DctTest@123 |
| Sales | sales.test3@dctcrm.com | DctTest@123 |
| CRM | crm.test1@dctcrm.com | DctTest@123 |
| CRM | crm.test2@dctcrm.com | DctTest@123 |
| CRM | crm.test3@dctcrm.com | DctTest@123 |
| Finance | finance.test1@dctcrm.com | DctTest@123 |
| Finance | finance.test2@dctcrm.com | DctTest@123 |
| Finance | finance.test3@dctcrm.com | DctTest@123 |
| Manager | manager.test1@dctcrm.com | DctTest@123 |
| Manager | manager.test2@dctcrm.com | DctTest@123 |
| Manager | manager.test3@dctcrm.com | DctTest@123 |
| Recovery | recovery.test1@dctcrm.com | DctTest@123 |
| Recovery | recovery.test2@dctcrm.com | DctTest@123 |
| Recovery | recovery.test3@dctcrm.com | DctTest@123 |

## Test Login

1. Start the application with `npm run dev`.
2. Open `http://localhost:3000/login`.
3. Use a profile-specific test user above.
4. Verify the displayed profile and test its effective permissions.

### Channel Partner Portal

The CP portal runs separately at `http://localhost:3002/login`. Its accounts
are separate from CRM users and are not created by the CRM test-user seed.
Sign in to the CRM as an administrator, open **Setup → CP Portal Accounts**,
and create a portal account before signing in with its username or email and
password.

Local service URLs:

- Web: `http://localhost:3000`
- API: `http://localhost:3001`
- AI: `http://localhost:8001`
- CP Portal: `http://localhost:3002`

### Lead API test users

Lead creation is allowed for:

- `admin.test1@dctcrm.com`
- `admin.test2@dctcrm.com`
- `admin.test3@dctcrm.com`
- `presales.test1@dctcrm.com`
- `presales.test2@dctcrm.com`
- `presales.test3@dctcrm.com`

Lead creation is denied for negative API tests using:

- `sales.test1@dctcrm.com`
- `svc.test1@dctcrm.com`
- `crm.test1@dctcrm.com`
- `finance.test1@dctcrm.com`
- `manager.test1@dctcrm.com`
- `recovery.test1@dctcrm.com`

## Project Structure

```
dct-crm/
├── apps/
│   ├── api/          # Express.js backend
│   └── web/          # Next.js frontend
├── packages/
│   ├── db/           # Prisma schema & migrations
│   └── shared/       # Shared Zod schemas
```

## Lead duplicate handling

Manual Lead creation is processed by the backend `processLeadEnquiry` service.
It validates contact data, checks for duplicates inside the create transaction,
and only sends a genuinely new Lead through the existing assignment workflow.
A single match is retained as the Main Lead and receives a source-specific
`Enquiry` record; multiple matches are returned as an ambiguous conflict for
review rather than selecting a Lead arbitrarily. This repository does not
contain Salesforce `SLeadTrigger` or `RelatedSourceHandler.duplicateCheck2()`
source code; the equivalent source-history model here is `Enquiry`.

Phone matching compares all three submitted phone slots with stored Lead phone
slots and phone slots on related `Enquiry` records. Formatting is removed and
country calling codes are included in normalized identities. Email matching
trims whitespace and ignores case across primary and secondary email slots.
Manual creation, GRE, Channel Partner Portal, and CSV Lead imports use the
backend matcher. CSV Lead rows are normalized and matched in one batched lookup,
then processed under one transaction with sorted contact locks; a conflict or
invalid row rolls back the entire import. Enquiries for a different project
are attached to the existing Lead without replacing its primary project
association.

Apply the additive country-code columns and normalized lookup indexes before
starting an API built with this change:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f packages/db/migrations/20261011_lead_duplicate_detection.sql
```

Lead detail queries also load related Opportunities. Ensure the database has
the nullable `Opportunity.notes` column expected by the Prisma schema:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f packages/db/migrations/20261011_opportunity_notes.sql
```

Run focused backend checks with:

```bash
node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json
node node_modules/vitest/vitest.mjs run apps/api/src
```

The database-backed concurrency test is opt-in. Run it against a local seeded
database with:

```bash
LEAD_DUPLICATE_INTEGRATION=1 node node_modules/vitest/vitest.mjs run \
  apps/api/src/services/enquiryProcessing.integration.test.ts
```
# crm
