---
inclusion: always
---

# Project Structure

`perfxcel-api` is an Express REST API (LMS backend) that talks directly to Supabase and serves the PerfXcel frontend.

```
src/
├── app.ts                # Express app: middleware registration and route mounting
├── server.ts             # Entry point — binds the port, imports app
├── routes/               # One file per resource; defines Router and per-route middleware
│   ├── courses.ts
│   ├── taxonomies.ts
│   ├── interests.ts
│   ├── enrollments.ts
│   ├── enquiries.ts
│   ├── verify.ts
│   ├── metrics.ts
│   ├── auditLogs.ts
│   └── contact.ts
├── controllers/          # Request handlers — all business logic lives here
├── middleware/
│   ├── auth.ts           # requireAuth — validates Supabase Bearer JWT, sets req.user
│   └── tenant.ts         # requirePerfxcelTenant — verifies tenant membership, sets req.tenantId
├── db/
│   └── supabase.ts       # Supabase client (service role, perfxcel schema)
├── utils/
│   └── course.ts         # Domain utilities (e.g. computeIsBlended)
├── types/
│   └── express.d.ts      # Express Request augmentations: req.user, req.tenantId
└── __tests__/            # Jest tests
dist/                     # Compiled output — do not edit
```

## Architecture Rules

- **`app.ts` mounts routes; controllers own business logic.** Keep `app.ts` to middleware setup and `app.use(...)` calls only. Never write request-handling logic there.
- **One router file per resource.** Add new resources by creating `src/routes/<resource>.ts` and mounting it in `app.ts`.
- **Controllers are plain async functions** `(req: Request, res: Response)`. All controllers must be wrapped with `asyncHandler` from `@dotevolve/error-utils` at the route level — never inside the controller itself.
- **Never call `res.status(4xx/5xx).json(...)` directly.** Throw typed error classes (`AppError`, `NotFoundError`, `AuthenticationError`, `AuthorizationError`) from `@dotevolve/error-utils` instead.
- **Soft deletes only.** Records are never hard-deleted; set `status: 'deleted'` and `deleted_at` timestamp. Queries must filter `neq("status", "deleted")` by default unless `include_deleted=true` is explicitly requested.

## Middleware Registration Order (`app.ts`)

```ts
initializeSentry(...)          // must be called first, before Express
app.use(helmet())
app.use(cors())
app.use(morgan("dev"))
app.use(express.json())
setupSentryMiddleware(app)     // Sentry request tracking
// routes...
setupSentryErrorHandler(app)   // must be before errorHandlerMiddleware
app.use(errorHandlerMiddleware)
```

`setupSentryErrorHandler` must come after all routes and before `errorHandlerMiddleware`. Never reorder these.

## Authentication & Tenant Guard

Apply middleware at the **route level**, not globally in `app.ts`:

```ts
// Public route — no auth
router.get("/", asyncHandler(handler));

// Protected route — requires auth + tenant membership
router.post("/", requireAuth, requirePerfxcelTenant, asyncHandler(handler));
```

- `requireAuth` validates the Supabase Bearer JWT and attaches `req.user`.
- `requirePerfxcelTenant` verifies the authenticated user is a member of the `perfxcel` tenant and attaches `req.tenantId`.
- Both middleware bypass all checks when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are unset (dev mode). **Never remove the null-check guard.**

## Database

- All controllers use the `supabase` client from `src/db/supabase.ts` (service role key, `perfxcel` schema).
- The `tenant.ts` middleware uses a separate `portalSupabase` client targeting the `public` schema for cross-tenant lookups.
- Use `!inner` join syntax on Supabase queries when filtering by a related table's column.
- Always handle Supabase errors explicitly — check `{ data, error }` and throw an appropriate `AppError` on error.

## Response Shape

All successful responses follow this convention:

```ts
// Collection
res.status(200).json({ status: "success", results: n, total: count, page, limit, data: [...] });

// Single resource
res.status(200).json({ status: "success", data: { ... } });

// Created
res.status(201).json({ status: "success", data: { ... } });

// Deleted (soft)
res.status(204).send();
```

## TypeScript Conventions

- Strict mode is enabled. No `any` without an explicit justification comment.
- Express `Request` augmentations (`req.user`, `req.tenantId`) are declared in `src/types/express.d.ts`. Add new augmentations there.
- Controllers receive `Request` and `Response` from `express` — do not use `NextFunction` unless writing middleware.

## Testing

- Tests live in `src/__tests__/`. Use Jest 29 with `supertest`.
- The app is exported as `default` from `src/app.ts` for `supertest` integration tests.
- Auth and tenant checks are bypassed in tests when Supabase env vars are unset — rely on this rather than mocking middleware.
- Run tests: `npm test` (single pass, `--forceExit`).
