---
inclusion: always
---

# Product: Perfxcel API (`perfxcel-api`)

A TypeScript/Express REST API for the Perfxcel LMS compliance platform. It handles business logic, database access, authentication, and tenant verification directly — this is **not** a thin proxy. It serves both public-facing consumers (course browsing, interest registration) and admin consumers (`perfxcel-app`).

## Project Structure

```
src/
├── app.ts              # Express app setup — Sentry, middleware, route registration
├── server.ts           # HTTP server entry point (not started in test env)
├── db/
│   └── supabase.ts     # Supabase client (service role, schema: perfxcel)
├── middleware/
│   ├── auth.ts         # requireAuth — validates Bearer JWT via Supabase
│   └── tenant.ts       # requirePerfxcelTenant — DB lookup to verify tenant membership
├── routes/             # One file per resource (Router instances)
├── controllers/        # Handler functions — all DB logic lives here
├── utils/              # Pure helpers (e.g. computeIsBlended)
└── types/
    └── express.d.ts    # Global Express.Request augmentation (user, tenantId)
```

## Architectural Conventions

- **Routes are thin.** Each `src/routes/*.ts` file mounts a `Router` and wires middleware + controllers. No business logic in route files.
- **Controllers own DB logic.** All Supabase queries live in `src/controllers/`. Controllers are plain async functions `(req, res)` — no `next()` calls; errors are thrown and caught by `asyncHandler`.
- **Always wrap controller functions with `asyncHandler`** from `@dotevolve/error-utils` in routes. Never use raw `async (req, res) => {}` on a router.
- **Never write `res.status(4xx).json(...)` inline.** Throw typed errors instead (`NotFoundError`, `AppError`, `AuthenticationError`, `AuthorizationError`) from `@dotevolve/error-utils`.
- **Error middleware runs last.** `setupSentryErrorHandler` then `errorHandlerMiddleware` are registered at the bottom of `app.ts` after all routes — do not move them.
- **Sentry is initialized before Express.** `initializeSentry(...)` is called at the top of `app.ts` before `express()`. Do not move it.

## Database

- The primary Supabase client (`src/db/supabase.ts`) uses the **service role key** and targets the `perfxcel` schema.
- `src/middleware/tenant.ts` uses a **separate** `portalSupabase` client targeting the `public` schema to verify tenant membership (`tenants`, `user_tenant_roles` tables).
- Soft-delete pattern: `deleteCourse` sets `status: 'deleted'` and `deleted_at` — never hard-deletes. Apply the same pattern for other resources unless explicitly specified otherwise.
- Many-to-many relations (e.g. `course_categories`, `course_cities`) are managed with a delete-all + re-insert strategy on update.

## Authentication & Tenant Middleware

### `requireAuth` (`src/middleware/auth.ts`)

- Validates `Authorization: Bearer <token>` with `supabase.auth.getUser(token)`.
- Attaches `req.user` (Supabase `User` object).
- Throws `AuthenticationError` for missing/malformed headers or invalid tokens.
- **Dev bypass:** if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` are unset, auth is skipped with a warning. Never remove this guard.

### `requirePerfxcelTenant` (`src/middleware/tenant.ts`)

- Performs a DB lookup to confirm the authenticated user is a member of the `perfxcel` tenant.
- Sets `req.tenantId` on success.
- Throws `AuthorizationError` if the tenant or membership is not found.
- Depends on `req.user` — must be chained after `requireAuth`.

### Route Auth Pattern

```ts
// Public
router.get("/", asyncHandler(handler));

// Admin-only
router.post("/", requireAuth, requirePerfxcelTenant, asyncHandler(handler));
```

## Key Middleware Stack (in order)

1. `helmet()` — security headers
2. `cors()` — CORS
3. `morgan("dev")` — request logging
4. `express.json()` — body parsing
5. `setupSentryMiddleware(app)` — Sentry request tracing
6. Route handlers
7. `setupSentryErrorHandler(app)` — Sentry error capture
8. `errorHandlerMiddleware` — generic error responses

## Response Format

Successful responses follow this shape:

```json
{ "status": "success", "data": { ... } }
```

Paginated list responses include:

```json
{ "status": "success", "results": 10, "total": 100, "page": 1, "limit": 20, "data": [...] }
```

## Cloudflare Turnstile

Course interest registration (`POST /api/v1/courses/:id/interest`) verifies a Turnstile token before inserting. The allowed hostnames are controlled by `VITE_PERFXCEL_TURNSTILE_HOSTNAMES` (comma-separated). Always validate the token server-side at `https://challenges.cloudflare.com/turnstile/v0/siteverify` before inserting any interest record.

## Environment Variables

| Variable                             | Purpose                                 |
| ------------------------------------ | --------------------------------------- |
| `SUPABASE_URL`                       | Supabase project URL                    |
| `SUPABASE_SERVICE_ROLE_KEY`          | Service role key (bypasses RLS)         |
| `SENTRY_DSN`                         | Sentry error reporting                  |
| `VITE_PERFXCEL_TURNSTILE_SECRET_KEY` | Turnstile server-side secret            |
| `VITE_PERFXCEL_TURNSTILE_HOSTNAMES`  | Comma-separated allowed hostnames       |
| `PORT`                               | HTTP server port (default `8000`)       |
| `NODE_ENV`                           | Set to `test` to prevent server startup |

## Testing

- Runner: **Jest 29** with `ts-jest` preset; environment: `node`.
- Integration tests use `supertest` against the exported `app` default from `src/app.ts`.
- The HTTP server does **not** start when `NODE_ENV=test`.
- Test files live in `src/__tests__/`.
- Property-based tests use `fast-check` with the `.property.test.ts` suffix.
- Run: `npm test` (single pass) or `npm run test:coverage`.

## Adding a New Resource

1. Create `src/routes/<resource>.ts` — define a `Router`, apply auth middleware as needed, wrap all handlers with `asyncHandler`.
2. Create `src/controllers/<resource>Controller.ts` — all Supabase queries go here; throw typed errors, never call `next()`.
3. Register the router in `src/app.ts` under `/api/v1/<resource>`.
4. If the resource uses soft-delete, set `status: 'deleted'` and `deleted_at` rather than hard-deleting.
