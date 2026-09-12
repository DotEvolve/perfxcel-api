---
inclusion: always
---

# Project Structure

```
api/
├── index.ts           # Single entry point — all routes, middleware, and proxy config live here
├── utils/
│   └── logger.ts      # Winston logger singleton — use this, never console.log
└── types/
    └── express.d.ts   # Express Request augmentations (req.user, req.tenantId, req.correlationId)
__mocks__/             # Jest manual mocks
__tests__/             # Jest tests
├── gateway.test.ts
├── infra.test.ts
├── proxy-urls.test.ts
├── startup.test.ts
├── resolveTenant.unit.test.js
├── resolveTenant.property.test.js   # fast-check property-based tests
└── utils/             # Test utilities and helpers
dist/                  # Compiled TypeScript output — do not edit
```

## Critical Architecture Rules

- **All route definitions live exclusively in `api/index.ts`.** There is no `routes/` directory. Do not create one.
- **No business logic in the gateway.** The gateway only authenticates, resolves tenant, and proxies. Domain logic belongs in `perfxcel-workflow-service`.
- **No database.** The gateway holds no state and makes no DB calls.

## Route Registration Order (mandatory)

Public routes **must** be registered before the protected middleware chain:

```ts
// 1. Public routes (no auth)
app.get('/health', ...)
app.use('/api/v1/webhooks', proxy(...))
app.use('/api/v1/tenants/signup', proxy(...))
// ...other public routes...

// 2. Protected routes — requireAuth → resolveTenant runs for everything below
app.use('/api/v1', requireAuth, resolveTenant, proxy(...))
```

Any route that must bypass auth must appear **above** the `app.use('/api/v1', requireAuth, resolveTenant)` line.

## Middleware

Middleware is defined inline in `api/index.ts` — there is no separate `middleware/` directory.

Key middleware in registration order:
1. `initializeSentry(...)` — **must be called first**, before any Express import
2. `setupSentryMiddleware(app)` — Sentry request tracking
3. `correlationIdMiddleware` — attaches `X-Correlation-Id` to every request
4. `requireAuth` — validates Supabase Bearer JWT, attaches `req.user`
5. `resolveTenant` — extracts `activeTenantId` from JWT claims, sets `req.tenantId`
6. `setupSentryErrorHandler(app)` — **must be last**

## Proxy Configuration

All downstream requests go to `perfxcel-workflow-service` via `express-http-proxy`.

Every authenticated proxy request decorates headers via `workflowProxyOptions`:
- `x-user-email` — from `req.user.email`
- `x-tenant-id` — from `req.tenantId`
- `x-correlation-id` — from `req.correlationId`

Special proxy flags:
- `parseReqBody: false` is **required** for `/api/v1/idp` (multipart) and `/api/v1/events` (SSE) to prevent body corruption.

## TypeScript Conventions

- Strict mode is enabled — no `any` without an explicit justification comment.
- Express `Request` augmentations (`req.user`, `req.tenantId`, `req.correlationId`) are declared in `api/types/express.d.ts`. Add new augmentations there.

## Error Handling

- Use `errorHandlerMiddleware` and `setupSentryErrorHandler` from `@dotevolve/error-utils/express`.
- Never write `res.status(4xx).json(...)` directly in route handlers — throw typed `AppError` subclasses instead.

## Logging

- Use `api/utils/logger.ts` (Winston) for all logging. Never use `console.log` in production code.

## Testing

- Tests live in `__tests__/`. Use Jest 30 with `supertest` and `nock`.
- Property-based tests use `fast-check` and the `.property.test.js` suffix.
- The app is exported as `default` from `api/index.ts` for `supertest` integration tests.
- The server does **not** start when `NODE_ENV=test`.
- Auth bypass is active when `SUPABASE_URL`/`SUPABASE_ANON_KEY` are unset — never remove the null-check guard.
