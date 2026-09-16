# API Gateway Auth — Requirements

## Overview

All routes in `perfxcel-api` are currently unprotected. The `/api/v1/metrics` endpoint exposes sensitive business data (enrollment counts, lead counts). All admin-facing routes (courses, taxonomies, interests, enrollments, metrics) MUST require a valid Supabase JWT before the request is processed.

The public routes (`/health`, `/api/v1/verify`) MUST remain unauthenticated.

This spec introduces a `requireAuth` middleware and applies it to all admin routes.

---

## Requirements

### REQ-1: Auth Middleware

**REQ-1.1** A new middleware function `requireAuth` MUST be created in `src/middleware/auth.ts`.

**REQ-1.2** The middleware MUST extract the Bearer token from the `Authorization` header using the pattern `Authorization: Bearer <token>`.

**REQ-1.3** If the `Authorization` header is missing or does not follow the `Bearer <token>` format, the middleware MUST throw an `AuthenticationError` from `@dotevolve/error-utils`. It MUST NOT call `res.status(401).json(...)` directly.

**REQ-1.4** The middleware MUST verify the token by calling `supabase.auth.getUser(token)` using the existing Supabase client singleton from `src/db/supabase.ts`.

**REQ-1.5** If `supabase.auth.getUser` returns an error or a null user, the middleware MUST throw an `AuthenticationError`. It MUST NOT call `res.status(403).json(...)` directly.

**REQ-1.6** If verification succeeds, the middleware MUST attach the verified user object to `req.user` and call `next()`.

**REQ-1.7** The `req.user` augmentation MUST be declared in `src/types/express.d.ts` so that `req.user` is typed across the codebase. It MUST NOT be extended inline in the middleware file.

**REQ-1.8** The middleware MUST include a development bypass: if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` are unset (falsy), the middleware MUST skip verification, log a warning, and call `next()` without setting `req.user`. This guard MUST NOT be removed.

---

### REQ-2: Apply Auth to Admin Routes

**REQ-2.1** The following routes MUST be protected by `requireAuth` middleware — it MUST be applied at the route-file level (not globally in `app.ts`):

| Route file | Routes protected |
|---|---|
| `src/routes/courses.ts` | All routes (`GET /`, `GET /:id`, `POST /`, `PUT /:id`, `PATCH /bulk`, `DELETE /:id`) except `POST /:id/interest` (public — tenant-facing) |
| `src/routes/taxonomies.ts` | All routes |
| `src/routes/interests.ts` | All routes |
| `src/routes/enrollments.ts` | All routes |
| `src/routes/metrics.ts` | The single `GET /` route |

**REQ-2.2** The public course interest registration route `POST /courses/:id/interest` MUST remain unprotected — it is called by tenant-facing apps, not the admin dashboard.

**REQ-2.3** The following routes MUST remain completely unauthenticated:

| Route | Reason |
|---|---|
| `GET /health` | Infrastructure health check |
| `GET /api/v1/verify` | Certificate verification — public facing |
| `GET /api/v1/verify/:id/pdf` | Certificate PDF download — public facing |

---

### REQ-3: TypeScript

**REQ-3.1** A `src/types/` directory MUST be created with `src/types/express.d.ts` containing the Express `Request` augmentation for `req.user`.

**REQ-3.2** The `req.user` type MUST use Supabase's `User` type from `@supabase/supabase-js`.

**REQ-3.3** All code MUST type-check cleanly with `tsc -b`. No `any` types may be introduced.

---

### REQ-4: Tests

**REQ-4.1** A unit test file MUST be created at `src/__tests__/middleware/auth.test.ts`.

**REQ-4.2** The tests MUST cover:
- Missing `Authorization` header → throws `AuthenticationError`
- Malformed header (no `Bearer ` prefix) → throws `AuthenticationError`
- Valid header format but Supabase returns an error → throws `AuthenticationError`
- Valid header and valid token → calls `next()` and sets `req.user`
- Dev bypass (null Supabase env vars) → calls `next()` without verification

**REQ-4.3** Tests MUST mock `supabase.auth.getUser` — they MUST NOT make real network calls.

---

## Out of Scope

- Role-based access control (RBAC) — a separate `requireAdmin` guard is a follow-up concern
- Rate limiting per route — a separate concern
- Tenant resolution middleware — not applicable to this admin API (no multi-tenancy)
- Refresh token handling — the middleware verifies the access token only; token refresh is the client's responsibility
