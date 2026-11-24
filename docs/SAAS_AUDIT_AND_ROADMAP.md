# Camsik White-Label SaaS: Phase 1 Audit & Roadmap

Written for: the platform owner and the engineers who will build the SaaS layer.
Status date: 2026-11-23.

Scope note: this audit covers the repo structure, the SaaS control-plane code, the
security posture of the APIs, and the build/deploy surface. It is a structural
audit, not a line-by-line review of all ~300 Flutter/Next.js source files. Business
modules (buy/sell/repair/rent, payouts, OTP, etc.) were inventoried by path, not
functionally tested.

---

## 1. What exists today

### 1.1 Repository layout

| Path | What it is | Stack |
|---|---|---|
| `camsik-user/` | Customer app (Android, iOS, web, desktop shells) | Flutter, 131 Dart files, appId `in.camsik.user` |
| `camsik-partner/` | Partner app | Flutter, 73 Dart files, appId `in.camsik.partner` |
| `camsik-delivery/` | Delivery agent app | Flutter, 53 Dart files, appId `in.camsik.delivery` |
| `camsik-admin/` | Internal admin app | Flutter, 92 Dart files, appId `in.camsik.admin` |
| `casmik/frontend/` | Public website (user web) | Next.js 15 + Tailwind, port 3000 |
| `casmik/backend/` | Main API server (Next.js route handlers) + Supabase migration | Next.js 15, port 4028, MongoDB + Supabase |
| `super_admin/` | Existing SaaS control plane UI + API | Next.js 15 + Tailwind, port 4030, MongoDB |

Important correction to the brief: the "12 applications" are **4 Flutter codebases**
(user, partner, delivery, admin), each built for Android/iOS (and web/desktop
folders that exist but are not the stated deliverable). The website panels are
the two Next.js apps. So the real build surface is 4 mobile apps + the web apps,
not 12 independent codebases. The white-label design should be built around that.

### 1.2 Data stores (two of them, in parallel)

- **MongoDB** is the operational store for the existing platform and the SaaS
  control plane: `casmik/backend/src/lib/mongodb.ts`, `casmik/frontend/src/lib/mongodb.ts`,
  `super_admin/src/lib/mongodb.ts`. Default master DB name `casmik_saas_platform`,
  tenant DBs named `casmik_tenant_<slug>`.
- **Supabase (Postgres)** has a single migration,
  `casmik/backend/supabase/migrations/20260824183336_casmik_platform_schema.sql`,
  and `lib/supabase/{client,server}.ts` plus auth helpers. Usage of Supabase
  versus Mongo for the same entities is **not clear** from this audit and must be
  decided (see §5, decision D1).

### 1.3 The SaaS layer that already exists (two copies)

The SaaS logic is **duplicated**:

| Concern | `super_admin/src/lib/` | `casmik/backend/src/lib/saas/` |
|---|---|---|
| Tenant registry | `tenantMaster.ts` (338 lines) | `tenantMaster.ts` (367 lines) |
| Tenant DB provisioning | `tenantDb.ts` (357 lines) | `tenantDb.ts` (320 lines) |
| Theme registry | `themesRegistry.ts` (773) | `themesRegistry.ts` (772) |
| Templates | `templates.ts` | `templates.ts` |
| Types | `types.ts` (215) | `types.ts` (215) |

These are near-identical copies that will drift. The target design (§4) makes
`super_admin` the only control plane and `casmik/backend` the only tenant-facing
API, sharing one package.

Existing super_admin API routes (`super_admin/src/app/api/`):
`clients` (CRUD), `clients/[id]/provision`, `clients/[id]/status`,
`clients/[id]/duplicate`, `clients/[id]/impersonate`, `domains`,
`domains/[domain]/verify`, `builds`, `templates`.

Existing UI components: `TenantCreationWizard.tsx` (753 lines) and
`ThemePreviewStudio.tsx` (780 lines). These are real working screens, not
placeholders, but are not yet verified end-to-end.

Existing backend SaaS routes: `api/saas/clients`, `api/saas/clients/[id]`,
`api/saas/clients/[id]/provision`, `api/saas/templates`, `api/saas/store/[slug]`.

### 1.4 Existing backend business API (reusable)

`casmik/backend/src/app/api/` contains about 40 route groups: auth (OTP, login,
signup, register, profile, me), orders, orders/messages, partners (dashboard,
events, payouts, inspection-criteria), delivery/events, delivery-agents,
device-verification (IMEI validation with a provider interface), categories,
brands, models, banners, coupons, pincodes, cities, rentals, refurbished,
lenses, questions, notifications, support-tickets, payouts, imagekit upload/auth,
admin/overview. This is the business logic to preserve.

Device verification (`lib/deviceVerification/`, with `tacDatabase`, `luhn`,
`providers/imeiInfoProvider.ts`) is a self-contained module and a good candidate
to keep as-is.

### 1.5 Build & config

- Flutter apps: Gradle Kotlin DSL (`build.gradle.kts`), appIds hard-coded per app,
  base URL hard-coded in `camsik-user/lib/core/constants/api_constants.dart`
  (`https://casmik-one.vercel.app`, toggled by a `useLocalBackend` const).
- Next.js apps: standard `next build`; no CI config found in the repo.
- No Dockerfile, no CI workflow, no test suite beyond the default Flutter
  `widget_test.dart` stubs.

---

## 2. Security & correctness findings

Severity: **Critical** (exploitable now / credential exposure), **High**
(broken isolation or auth), **Medium**, **Low**.

### 2.1 Critical

**C1. Live-looking MongoDB credential hard-coded and committed.**
`mongodb+srv://adarshsachan9967_db_user:<password>@camsik.oxiqz3o.mongodb.net`
was used as a fallback in `super_admin/src/lib/mongodb.ts`,
`casmik/backend/src/lib/mongodb.ts` and `casmik/frontend/src/lib/mongodb.ts`,
and is present in git history (initial commits).
- **Done in this session:** the fallback was removed from all three files, so the
  code now requires `MONGODB_URI` from the environment.
- **Still required from you (I cannot do this):** rotate that Atlas database user
  password now. Removing it from the working tree does not remove it from git
  history or from anyone who has cloned the repo. If the repo is or was ever
  shared, treat the password as compromised.

**C2. No authentication on the Super Admin control plane.**
No auth or session guard exists in `super_admin/src` (no middleware, no
session check, no JWT). Anyone who can reach port 4030 (or its deployment) can
create, duplicate, provision, suspend, impersonate, and delete tenants. The
`/api/clients/[id]/impersonate` route returns a session token with no
verification anywhere.

**C3. Impersonation is not a real security control.**
`impersonate/route.ts` builds the token as
`imp_<id>_<Date.now()>_<Math.random()>`, which is guessable, is never checked by
any receiving endpoint, and hard-codes `impersonatedBy: 'Super Admin'` in the audit
log instead of the real actor. The `portalUrl` points at `http://localhost:3000`.

### 2.2 High

**H1. The same SaaS routes are unauthenticated in the backend too.**
`casmik/backend/src/app/api/saas/clients` `POST` creates a tenant and provisions a
database with no check. Anyone can call it.

**H2. Blanket CORS on all API routes.**
`casmik/backend/src/middleware.ts` sets `Access-Control-Allow-Origin: *` on every
`/api/*` route, including any future admin route. Combined with H1 this allows
any website to call the APIs from a victim's browser.

**H3. Domain verification can be bypassed.**
`super_admin/src/app/api/domains/[domain]/verify/route.ts` sets
`isVerified = cnameResolved || txtResolved || process.env.NODE_ENV === 'development'`.
Any DNS failure marks the domain active in development, and the CNAME check
accepts any name containing the substring `camsik`, so `camsik.evil.example`
passes. Both need fixing before domain routing (§4.4) is trusted.

**H4. Tenant isolation is by database name only.**
`getTenantDatabase(slugOrDbName)` in `tenantDb.ts` accepts a raw `casmik_tenant_*`
string from the caller and connects to that DB. Nothing binds the request to the
tenant of the authenticated user. The domain-to-tenant map is not used for
resolution on the request path. This is the isolation gap the brief warns about
("never trust a client-provided tenant ID").

**H5. Shared Mongo cluster with one credential.**
All tenants (and the control plane) use the same Atlas cluster and the same
database user. A leak from any tenant exposes every tenant. Per-tenant DB
credentials, as the brief requires, are not implemented: `tenantDb.ts` uses the
single global client.

### 2.3 Medium

- **M1.** Two copies of the SaaS library (§1.3) will diverge. Already partially
  divergent by line count.
- **M2.** Build jobs (`/api/builds` POST) only insert a `build_jobs` record. No
  worker exists, so the "build" is a record, not an APK/IPA. The UI must not
  present it as a built artifact (the brief forbids this too).
- **M3.** `.env` files exist next to code (`super_admin/.env`, `casmik/*/.env`).
  The `.env.example` files are tracked and safe. The real `.env` files are not tracked
  (verified with `git ls-files`), which is correct, but there is no secret manager.
- **M4.** `.gitignore` has an unrelated working-tree change (`.idea/` appended,
  no trailing newline). `casmik/*/node_modules` directories are tracked in git
  (git status shows them as deleted) — they should be removed from the index
  with `git rm -r --cached` and ignored.
- **M5.** Flutter `api_constants.dart` hard-codes the production base URL and
  a fallback list containing `casmik.vercel.app`. Tenant apps need a per-tenant
  base URL injected at build time, not a constant.
- **M6.** No automated tests in any app beyond template stubs.

### 2.4 Low

- The customer support screen links a WhatsApp number directly in code
  (`wa.me/918976000010`). This must come from tenant config (phase 5/15).
- `super_admin` uses `next dev -p 4030` with `NODE_ENV === 'development'`
  branches that alter security behavior (H3). Behavior must not depend on the
  environment name for security decisions.

---

## 3. Reuse / refactor / build-new classification

**Reuse as-is (business logic):** Flutter screens and modules for the four apps
(after parameterizing base URL and branding); backend order, partner, delivery,
payout, notification, coupon, banner, category, brand, model, and pincode routes;
device verification module; `casmikData.ts` catalog shape (it is the seed
catalog for new tenants).

**Refactor:**
- Merge the two SaaS libraries into one shared package (`packages/saas-core`).
- Put every control-plane route behind authentication and RBAC.
- Replace `tenantDb.getTenantDatabase(name)` with a tenant resolver that takes
  the tenant from the verified session or verified domain, never from input.
- Make the Flutter apps read branding and base URL from a per-tenant config
  (runtime fetch for theme, build-time injection for appId/icons/base URL).
- Replace hard-coded contact numbers and strings with CMS/config values.
- Fix H3 (DNS verification) and H2 (CORS).

**Build new:**
1. Auth and RBAC for the control plane (super admins) and tenants (tenant admins).
2. Tenant-scoped data access layer with connection resolution per tenant.
3. Secrets store with encryption at rest for per-tenant DB credentials, API keys,
   and signing keys.
4. Provisioning job runner with per-step status (replaces the single synchronous
   POST that currently seeds everything inline).
5. Branding/theme studio persistence with draft/publish/version/rollback (the UI
   exists; the backend persistence and versioning do not).
6. CMS for all 12 panels (no CMS storage exists today).
7. Domain service with real DNS verification and an edge routing layer.
8. Build service: queue, isolated Linux worker for Android (`flutter build apk/appbundle`),
   separate macOS worker for iOS (`flutter build ipa`, Xcode, signing). Artifact storage
   with signed download URLs.
9. Subscription/billing (Razorpay) with webhook signature verification.
10. Test suites for tenant isolation (the brief's §19 security tests).

---

## 4. Target architecture

```
                 ┌──────────────────────────┐
  Super Admin ──▶│ super_admin (control UI) │──┐
                 └──────────────────────────┘  │
                                               ▼
                 ┌──────────────────────────────────────────┐
                 │ Control-plane API (auth + RBAC + audit)   │
                 │  tenants · plans · domains · builds ·     │
                 │  themes · CMS publish · provisioning jobs │
                 └───────┬───────────────┬──────────────────┘
                         │               │ enqueue
                         ▼               ▼
              Master DB (Mongo)     Job queue + workers
              (registry, secrets    ├─ provisioning worker
               refs, audit)         ├─ Android build worker (Linux)
                                    └─ iOS build worker (macOS)
                                               │
   Tenant domain / subdomain ──▶ edge router ──▶ tenant resolver
                                               │ (verified domain → tenantId)
                                               ▼
                 ┌──────────────────────────────────────────┐
                 │ Tenant business API (casmik/backend)      │
                 │  tenant-scoped data access layer           │
                 └───────┬──────────────────────────────────┘
                         ▼
              Per-tenant DB (own DB + own credentials)
```

### 4.1 Tenancy model

- **Per-tenant database** (Mongo database per tenant) as the brief prefers. This
  is achievable on Mongo with a **separate database user per tenant** with
  `readWrite` on only that database. That gives real isolation at the DB layer,
  not just naming. Today a single shared user is used (H5); fixing this is a
  phase-B deliverable.
- Trade-off: one Atlas cluster with thousands of databases has connection and
  cost limits. Mitigation: pool clients per cluster and move large tenants to
  dedicated clusters later.

### 4.2 Auth

- Super admin and tenant users are different identity spaces with separate
  issuers and signing keys, so a tenant token cannot be used on control-plane routes.
- Short-lived access tokens, rotating refresh tokens, server-side session revocation.
- Passwords hashed with argon2id or bcrypt; email verification and password reset.
- Impersonation: a real session with the real actor, a short TTL, a visible banner
  in the tenant panel, and an audit record written before the session is issued.

### 4.3 Secrets

- Per-tenant DB credentials, API keys, Apple/Google signing material are encrypted
  with a per-tenant data key wrapped by a master key (KMS or env-held key in
  development). Plaintext never leaves the server and is never returned by any
  API (only "configured: yes/no" and a masked suffix).

### 4.4 Domains

- Default subdomain `<slug>.<platform-domain>` created at tenant creation.
- Custom domains: TXT challenge verification, then CNAME/A/AAAA target
  check, then certificate issuance through the hosting provider (Vercel API
  or Cloudflare for SaaS), then activation. Each step records status and the
  exact DNS records to show the owner.
- Routing: the edge looks up the host in the verified-domain map and sets the
  tenant context. The request never supplies its own tenant id.

### 4.5 Theming

- Theme = design tokens + layout variant per panel, stored as versioned JSON in
  the master DB. Tenant overrides are stored as patches on top of the chosen theme.
- Flutter apps load theme JSON at startup (with a bundled fallback), so a
  theme change does not require a rebuild. Next.js panels read the same JSON.

### 4.6 Builds

- Build requests are queued jobs. Workers run `flutter build` in an isolated
  container (Linux for Android) or on a macOS host with Xcode (iOS). Tenant code
  is not executed on the API server.
- The tenant's Flutter app is generated from the shared source with injected
  config (appId, name, icons, base URL, Firebase files, signing from secret store).
- Artifacts are uploaded to private object storage; downloads use short-lived
  signed URLs checked against tenant identity.
- A build record moves to `completed` only when the artifact exists and its hash is
  recorded.

---

## 5. Decisions needed from you

These change the implementation, so I have not made them:

- **D1. Which database is the source of truth for tenant business data: MongoDB or Supabase?**
  Both are in use. Recommendation: pick one. Given the existing Mongo SaaS code
  and the Mongo-first business API, I recommend Mongo for tenant data and retiring
  the Supabase schema, unless the Supabase schema holds data you cannot lose.
- **D2. Are you willing to rotate the Atlas password now (C1)?** Required before any
  deployment, and I cannot do it from here.
- **D3. Hosting targets.** Recommend Vercel for the web panels (already used:
  `casmik-one.vercel.app`) and a worker host for builds. Android build workers
  can run on Linux; iOS requires a macOS host (a Mac mini or a macOS CI service).
  You need an Apple Developer account for each client to sign iOS builds.
- **D4. Scope of the first milestone.** The full brief is multi-month. Proposed
  first milestone: phases A–B plus the security fixes in §2 (auth, tenancy,
  secrets) before adding more UI.

---

## 6. Roadmap

Each phase ends with working code, tests, and a checklist update. Status column
is as of this document.

| # | Phase | Deliverable | Status |
|---|---|---|---|
| A | Audit & architecture | This document | Done |
| C1 | Remove hard-coded Mongo credential | Fallback removed in 3 files; `super_admin` type-check passes | Done (rotation pending, D2) |
| B0 | Remove tracked `node_modules` from git index; fix `.gitignore` | — | Pending |
| B1 | Control-plane auth (super admin login, sessions, lockout, CSRF origin check) | Every `super_admin` API route guarded | Done (single role `super_admin`; finer RBAC pending) |
| B2 | Remove duplicate SaaS write logic | Super Admin is the only writer; `casmik` copies are read-only | Done (shared package not created; copies are read-only and identical) |
| B3 | Tenant resolver + per-tenant DB user + secrets encryption | Isolation tests | Partial: DB name validated, forged/non-tenant DBs refused, AES-GCM helper with tests. Per-tenant Atlas DB users and storing tenant secrets with the helper are pending |
| B4 | Fix CORS (H2), DNS verification (H3), impersonation (C3) | Tests for each | Partial: H3 and C3 done with tests. H2 (CORS `*` in `casmik/backend/src/middleware.ts`) still open |
| C | White-label engine: theme JSON, branding persistence, draft/publish/rollback | Versioned theme store | Partial: draft/publish/rollback API with append-only versions is done. Theme JSON for Flutter apps and the UI wiring are pending |
| C-cms | CMS for 12 panels | Content schema + admin UI | Pending |
| D | 12-panel preview studio | Real rendering from app components (not screenshots) | Pending — largest UI risk |
| E | Tenant admin panel (RBAC, team, modules) | Tenant-scoped admin UI | Pending |
| F | Domains: subdomain + custom domain + SSL | Real DNS/SSL provider integration | Pending |
| G | Build pipeline: Android (Linux worker), iOS (macOS worker) | Queue, workers, signed artifacts | Pending |
| H | Billing (Razorpay), plans, usage limits, invoices | Webhook verification | Pending |
| I | CI/CD, monitoring, backups, prod deploy | — | Pending |

Blocked items (cannot be completed without something from you):
- Phase G iOS: needs a macOS build host and Apple Developer credentials.
- Phase F SSL/domains: needs the hosting provider account and the platform domain.
- Phase H: needs Razorpay keys and webhook secret.
- C1: needs Atlas password rotation (D2).

---

## 7. Changes made (session 1 and 2)

Decision D1 is answered: **MongoDB is the source of truth.**

### Security and tenancy (done, tested)
- Hard-coded Mongo credential removed from all three `mongodb.ts` files.
- Super Admin auth: first-run setup (closed once an admin exists), login with scrypt
  hashes, 5-attempt lockout, generic errors, sessions stored as SHA-256 hashes with
  Mongo TTL, 8-hour sessions, logout revokes server-side. Cookie is HttpOnly and SameSite=Strict.
  Edge middleware redirects pages and returns 401 for APIs; each handler verifies the session.
- Cross-origin state changes are refused by an Origin check.
- Tenant creation validates slug, reserved names, email and branding. The database name is
  derived from the slug and never taken from the caller.
- Update allowlist: identity, domains, database name and provisioning state cannot be
  changed through the API. Unknown fields are dropped.
- Branding values are type-checked: colours must be `#RRGGBB`, URLs must be https or a
  relative path (no `javascript:`).
- Owner password is never set or seen by the control plane. The owner gets a single-use
  invite token (72 h), stored only as a hash. (The old "direct password" option was removed.)
- Provisioning no longer deletes tenant settings on re-run (seeded once with `$setOnInsert`).
- Impersonation: real session, bound to one tenant, 30-minute TTL, returned once in the URL
  fragment, and audited with the real admin email.
- Domains: TXT ownership record plus CNAME (or A for apex) routing record, checked against
  live DNS. No development bypass, no substring matching. A domain belongs to one tenant at
  a time. Plan gate and domain count limit enforced. Verified is not reported as SSL active.
- Builds: a job is `queued` and carries no artifact. Nothing is claimed as built. Plan
  entitlement (Android/iOS) is enforced.
- Deletion: the tenant must be suspended or inactive, the slug must be typed back, and the
  database is dropped only when `dropDatabase: true` is sent. Audit is written first.
- Every sensitive action writes to `saas_audit_logs`. If the audit write fails, the action fails.
- `casmik` backend and frontend: the duplicate write-capable registry and provisioning code
  is now read-only. The write routes under `/api/saas/clients` were removed. The public store
  no longer exposes the tenant DB name.
- The unauthenticated `/saas-admin` page on the public site was replaced with a pointer.

### Tests
- `npm test` in `super_admin`: 43 tests, all passing.
  - 27 unit tests: crypto (hashing, encryption, tampering, key checks), validation,
    and domain verification with spoofed DNS answers.
  - 16 end-to-end flows against an in-memory MongoDB (`mongodb-memory-server`). They call the
    real route handlers and cover auth, lockout, CSRF, tenant creation, injection attempts,
    branding publish and rollback, domains, impersonation, build entitlement, audit,
    deletion, DB isolation and idempotent provisioning.
- `next build` passes for `super_admin`. `tsc --noEmit` passes for `super_admin`,
  `casmik/backend` and `casmik/frontend`.

### Still open (not built)
- Atlas per-tenant database users (needs Atlas API keys; code path is ready).
- CORS wildcard in `casmik/backend/src/middleware.ts` (H2). Changing it needs the list of
  allowed origins for the Flutter web builds.
- Branding Studio UI wired to the new draft/publish endpoints; Theme JSON consumed by Flutter.
- 15-theme library quality pass, 12-panel live preview, CMS for 12 panels.
- Tenant admin panel (RBAC roles, invite acceptance, tenant-side impersonation validation).
- Build workers (Android Linux, iOS macOS), artifact storage, signing.
- SSL issuance through a hosting provider, SMTP for invites, Razorpay billing.
- Removing `casmik/*/node_modules` from the git index (left alone: staging deletions was not requested).

Nothing has been committed.
