---
inclusion: always
---

# Tech Stack

## Core

| Concern | Library | Version |
|---|---|---|
| Runtime | Node.js | 24.x |
| Language | TypeScript | 6.x (strict mode) |
| Framework | Express | 5.x |
| Auth | @supabase/supabase-js | — |
| HTTP Client | Axios | — |
| Proxy | express-http-proxy | — |
| Logging | Winston | — |
| Error Handling | @dotevolve/error-utils/express | — |
| Error Tracking | @sentry/node | — |

## Testing

| Concern | Library | Version |
|---|---|---|
| Runner | Jest | 30.x |
| HTTP Integration | supertest | — |
| HTTP Mocking | nock | — |
| Property-Based | fast-check | — |

- Tests live in `__tests__/`. Property-based tests use the `.property.test.js` suffix.
- The app is exported as `default` from `api/index.ts` for `supertest` integration tests.
- The server does **not** start when `NODE_ENV=test`.
- Auth is bypassed when `SUPABASE_URL`/`SUPABASE_ANON_KEY` are unset — never remove the null-check guard.

## Common Commands

```bash
npm run dev            # Development server (tsx watch)
npm run build          # TypeScript compile
npm test               # Run tests
npm run test:coverage  # Tests with coverage
```

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: `8000`) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `WORKFLOW_SERVICE_URL` | Downstream workflow service URL (default: `https://workflow.perfxcel.net`) |
| `SENTRY_DSN` | Sentry DSN for error tracking |

### Secrets & OCI Vault Integration
- In OCI deployments, environment credentials (e.g. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SENTRY_DSN`) are injected into ephemeral container memory at runtime from OCI Vault via `scripts/compose-up.sh` (using `OCI_SECRET_ID_*` mappings in `.env.dev` / `.env.prod`). Never store plaintext credentials on the host or in repository files.
- In non-production and non-staging environments (where `NODE_ENV` is not `production` or `staging`), OCI Secrets Manager integration is skipped by default unless explicitly enabled by setting `OCI_VAULT_ENABLED=true`.

## Key Coding Conventions

### TypeScript
- Strict mode is enabled. No `any` without an explicit justification comment.
- Express `Request` augmentations (`req.user`, `req.tenantId`, `req.correlationId`) are declared in `api/types/express.d.ts`. Add new augmentations there — never extend `Request` inline.

### Error Handling
- Throw typed `AppError` subclasses (`ValidationError`, `AuthenticationError`, `AuthorizationError`, `NotFoundError`, `ConflictError`) from `@dotevolve/error-utils/express`.
- Never write `res.status(4xx).json(...)` directly in route handlers.
- Register `errorHandlerMiddleware` and `setupSentryErrorHandler` from `@dotevolve/error-utils/express`. `setupSentryErrorHandler` must be the **last** middleware registered.

### Logging
- Use `api/utils/logger.ts` (Winston singleton) for all logging. Never use `console.log` in production code.
- Log at appropriate levels: `error` for failures, `warn` for recoverable issues, `info` for significant events, `debug` for development tracing.

### Sentry Initialization
- `initializeSentry(...)` from `@dotevolve/error-utils/express` must be called **before** any `import` of Express or other middleware. Do not move or defer it.

### Auth & Tenant Resolution
- `requireAuth` validates `Authorization: Bearer <token>` via `supabase.auth.getUser(token)` and attaches `req.user`.
- `resolveTenant` reads `req.user.app_metadata.activeTenantId` (pure JWT claim extraction — no HTTP call) and sets `req.tenantId`.
- Auth bypass (when Supabase env vars are unset) is **development-only**. Never remove the null-check guard.

### Proxy
- All downstream traffic goes to `perfxcel-workflow-service` via `express-http-proxy`.
- Every authenticated proxy request must forward `x-user-email`, `x-tenant-id`, and `x-correlation-id` headers via `workflowProxyOptions`.
- `parseReqBody: false` is **required** for `/api/v1/idp` (multipart) and `/api/v1/events` (SSE) to prevent body corruption.

### Route Registration Order
Public routes must be registered **before** the protected middleware chain. Any route that bypasses auth must appear above `app.use('/api/v1', requireAuth, resolveTenant, ...)`.

### No Business Logic
The gateway only authenticates, resolves tenant, and proxies. Domain logic belongs in `perfxcel-workflow-service`. The gateway holds no state and makes no database calls.
