---
inclusion: always
---

# Product: Perfxcel LMS API Gateway

Thin reverse-proxy and authentication gateway for the Perfxcel LMS compliance platform. It sits between the frontend (`perfxcel-app`) and the downstream `perfxcel-workflow-service`, enforcing JWT authentication and tenant resolution before forwarding requests.

## Role in the Architecture

```
perfxcel-app  ──►  perfxcel-api-gateway  ──►  perfxcel-workflow-service
perfxcel-mca-extension  ──►  (public routes bypass auth)
```

The gateway owns **no business logic** and **no database**. Its only responsibilities are:
1. Verify Supabase JWTs (`requireAuth`)
2. Resolve the active tenant from JWT claims (`resolveTenant`)
3. Forward requests to `perfxcel-workflow-service` via `express-http-proxy`
4. Expose infrastructure metadata and health endpoints

## Route Table

All routes are defined in `api/index.ts`. There is no separate `routes/` directory.

### Public (no auth required)

| Path | Proxied to | Notes |
|---|---|---|
| `GET /health` | — | Gateway health check |
| `GET /` | — | Service info |
| `GET /infra` | — | Static infrastructure metadata |
| `GET /health/workflow` | Workflow Service `/` | Downstream health |
| `GET /health/documents` | Workflow Service `/api/v1/documents/health` | |
| `GET /health/database` | Workflow Service `/health/db` | |
| `/api/v1/webhooks` | Workflow Service | Inbound webhooks |
| `/api/v1/tenants/signup` | Workflow Service | Self-signup flow |
| `/api/v1/plans` | Workflow Service | Subscription plans |
| `/api/v1/mca/form-mappings` | Workflow Service | MCA extension (no auth) |

### Protected (JWT required)

All routes under `/api/v1` (except the public ones above) require a valid Supabase Bearer JWT. The `requireAuth` → `resolveTenant` middleware chain runs first.

| Path | Proxied to |
|---|---|
| `/api/v1/tenants` | Workflow Service |
| `/api/v1/workflows` | Workflow Service |
| `/api/v1/documents` | Workflow Service |
| `/api/v1/me` | Workflow Service |
| `/api/v1/entities` | Workflow Service |
| `/api/v1/idp` | Workflow Service (`parseReqBody: false` — multipart) |
| `/api/v1/mca` | Workflow Service |
| `/api/v1/events` | Workflow Service (`parseReqBody: false` — SSE) |
| `GET /api/v1/debug-tenant` | — | Debug: echoes resolved tenant |

## Key Middleware

### `requireAuth`
- Validates `Authorization: Bearer <token>` using `supabase.auth.getUser(token)`.
- Attaches `req.user` (Supabase user object with `app_metadata`).
- Returns `401` for missing/malformed header; `403` for invalid/expired token.
- If `SUPABASE_URL` or `SUPABASE_ANON_KEY` are unset, auth is **bypassed with a warning** (development only).

### `resolveTenant`
- Reads `req.user.app_metadata.activeTenantId` — no HTTP call, pure JWT claim extraction.
- Sets `req.tenantId` and forwards `x-tenant-id` header to downstream.
- Returns `401` if `activeTenantId` is missing on MCA or workflow routes.
- Non-tenant routes (e.g. `/api/v1/me`) proceed without a tenant ID.

### Proxy Header Decoration (`workflowProxyOptions`)
Every authenticated proxy request forwards:
- `x-user-email` — from `req.user.email`
- `x-tenant-id` — from `req.tenantId`
- `x-correlation-id` — from `req.correlationId`

## Key Conventions for AI Assistants

- **All route definitions live in `api/index.ts` only.** There is no `routes/` directory. Do not create one.
- **No business logic in the gateway.** If logic belongs to a domain, it goes in `perfxcel-workflow-service`.
- **Public routes must be registered before `app.use('/api/v1', requireAuth, resolveTenant)`** — order matters. Any route that should bypass auth must appear above that line.
- **`parseReqBody: false` is required** for multipart (`/api/v1/idp`) and SSE (`/api/v1/events`) routes to avoid body corruption.
- **Auth bypass is development-only.** Never remove the `supabase` null-check guard — it exists to allow local dev without credentials.
- **Error handling via `@dotevolve/error-utils/express`** — use `errorHandlerMiddleware` and `setupSentryErrorHandler`. Never write `res.status(4xx).json(...)` directly in route handlers.
- **Logging via `api/utils/logger.ts`** — never use `console.log` in production code.
- **Sentry must be initialized first** — `initializeSentry(...)` is called before any `import` of Express or middleware. Do not move it.

## Deployment

- Hosted on OCI (ap-mumbai-1).
- Downstream: `perfxcel-workflow-service` at `WORKFLOW_SERVICE_URL` (default: `https://workflow.perfxcel.net`).
- Auth: Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
- Port: `PORT` env var (default `8000`).

## Testing

- Tests live in `__tests__/`. Use Jest 30 with `supertest` and `nock`.
- Property-based tests use `fast-check` (`.property.test.js` suffix).
- The app is exported as `default` from `api/index.ts` for `supertest` integration tests.
- The server does **not** start when `NODE_ENV=test`.
