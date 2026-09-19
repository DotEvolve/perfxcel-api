---
inclusion: always
---

# Tech Stack

## Core Dependencies

| Concern        | Library                        | Version |
| -------------- | ------------------------------ | ------- |
| Runtime        | Node.js                        | 24.x    |
| Language       | TypeScript                     | 6.x     |
| Framework      | Express                        | 5.x     |
| Auth           | @supabase/supabase-js          | —       |
| HTTP Client    | Axios                          | —       |
| Proxy          | express-http-proxy             | —       |
| Logging        | Winston                        | —       |
| Error Handling | @dotevolve/error-utils/express | —       |
| Error Tracking | @sentry/node                   | —       |

## Testing

| Concern          | Library    | Version |
| ---------------- | ---------- | ------- |
| Runner           | Jest       | 30.x    |
| HTTP Integration | supertest  | —       |
| HTTP Mocking     | nock       | —       |
| Property-Based   | fast-check | —       |

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

| Variable               | Description                                                            |
| ---------------------- | ---------------------------------------------------------------------- |
| `PORT`                 | Server port (default: `8000`)                                          |
| `SUPABASE_URL`         | Supabase project URL                                                   |
| `SUPABASE_ANON_KEY`    | Supabase anon key                                                      |
| `WORKFLOW_SERVICE_URL` | Downstream workflow service (default: `https://workflow.perfxcel.net`) |
| `SENTRY_DSN`           | Sentry DSN for error tracking                                          |

OCI deployments inject secrets at runtime from OCI Vault via `scripts/compose-up.sh` (mapped by `OCI_SECRET_ID_*` in `.env.dev` / `.env.prod`). Never store plaintext credentials in the repo or on the host. OCI Vault is skipped unless `NODE_ENV` is `production`/`staging` or `OCI_VAULT_ENABLED=true`.

## Architecture: API Gateway Only

This service is a **pure gateway** — it authenticates, resolves tenant context, and proxies to `perfxcel-workflow-service`. It holds no state, makes no database calls, and contains no domain logic. Domain logic belongs in `perfxcel-workflow-service`.

## Coding Conventions

### TypeScript

- Strict mode is enabled. Never use `any` without an explicit justification comment.
- `Request` augmentations (`req.user`, `req.tenantId`, `req.correlationId`) are declared in `api/types/express.d.ts`. Add new augmentations there — never extend `Request` inline.

### Error Handling

- Throw typed `AppError` subclasses from `@dotevolve/error-utils/express`: `ValidationError`, `AuthenticationError`, `AuthorizationError`, `NotFoundError`, `ConflictError`.
- Never write `res.status(4xx).json(...)` directly in route handlers.
- Register `errorHandlerMiddleware` and `setupSentryErrorHandler` from `@dotevolve/error-utils/express`. `setupSentryErrorHandler` must be the **last** middleware registered.

### Sentry Initialization

`initializeSentry(...)` must be called **before** any `import` of Express or other middleware. Do not move or defer it.

### Logging

- Use the Winston singleton at `api/utils/logger.ts`. Never use `console.log` in production code.
- Use appropriate levels: `error` for failures, `warn` for recoverable issues, `info` for significant events, `debug` for development tracing.

### Auth & Tenant Resolution

- `requireAuth` validates `Authorization: Bearer <token>` via `supabase.auth.getUser(token)` and attaches `req.user`.
- `resolveTenant` reads `req.user.app_metadata.activeTenantId` (pure JWT claim — no HTTP call) and sets `req.tenantId`.
- The auth bypass (when Supabase env vars are unset) is development-only. Never remove the null-check guard.

### Route Registration Order

Public routes must be registered **before** the protected middleware chain. Any route that skips auth must appear above `app.use('/api/v1', requireAuth, resolveTenant, ...)`.

### Proxy

- All downstream traffic goes to `perfxcel-workflow-service` via `express-http-proxy`.
- Every authenticated proxy request must forward `x-user-email`, `x-tenant-id`, and `x-correlation-id` headers via `workflowProxyOptions`.
- Set `parseReqBody: false` for `/api/v1/idp` (multipart) and `/api/v1/events` (SSE) to prevent body corruption.
