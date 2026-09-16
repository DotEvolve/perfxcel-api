# API Gateway Auth — Implementation Tasks

## Task 1: Express Request Type Augmentation

Create `perfxcel-api/src/types/express.d.ts`.

- Declare a global augmentation of `Express.Request` to add `user?: User`
- Import `User` type from `"@supabase/supabase-js"`
- No exports — this is a pure ambient declaration file
- Verify `tsconfig.json` includes `src/types/` in its `include` glob; if not, add it

## Task 2: `requireAuth` Middleware

Create `perfxcel-api/src/middleware/auth.ts`.

- Import `Request`, `Response`, `NextFunction` from `"express"`
- Import `supabase` from `"../db/supabase"`
- Import `AuthenticationError` from `"@dotevolve/error-utils"`
- Compute `supabaseConfigured` once at module level: `Boolean(process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)`
- Implement and export `requireAuth` as an async Express middleware:
  - If `!supabaseConfigured`: log `console.warn("[requireAuth] Supabase not configured — skipping auth (dev only)")`, call `next()`, return
  - If `req.headers.authorization` is missing or does not start with `"Bearer "`: throw `new AuthenticationError("Missing or malformed Authorization header")`
  - Extract token: `authHeader.slice(7)`
  - Call `await supabase.auth.getUser(token)`
  - If `error` or `!data.user`: throw `new AuthenticationError("Invalid or expired token")`
  - Set `req.user = data.user`, call `next()`

## Task 3: Protect `src/routes/courses.ts`

Modify `perfxcel-api/src/routes/courses.ts`.

- Add `import { requireAuth } from "../middleware/auth"`
- Add `requireAuth` as middleware on every route **except** `POST /:id/interest`
- Ensure `POST /:id/interest` is registered **before** any `/:id` protected route to prevent route shadowing
- Route order after modification:
  ```
  router.post("/:id/interest", asyncHandler(registerInterest));      // public
  router.get("/",              requireAuth, asyncHandler(getCourses));
  router.get("/:id",           requireAuth, asyncHandler(getCourse));
  router.post("/",             requireAuth, asyncHandler(createCourse));
  router.put("/:id",           requireAuth, asyncHandler(updateCourse));
  router.patch("/bulk",        requireAuth, asyncHandler(bulkUpdateCourses));
  router.delete("/:id",        requireAuth, asyncHandler(deleteCourse));
  ```

## Task 4: Protect `src/routes/taxonomies.ts`

Modify `perfxcel-api/src/routes/taxonomies.ts`.

- Add `import { requireAuth } from "../middleware/auth"`
- Add `requireAuth` before `asyncHandler(...)` on every route in the file

## Task 5: Protect `src/routes/interests.ts`

Modify `perfxcel-api/src/routes/interests.ts`.

- Add `import { requireAuth } from "../middleware/auth"`
- Add `requireAuth` before `asyncHandler(...)` on every route in the file

## Task 6: Protect `src/routes/enrollments.ts`

Modify `perfxcel-api/src/routes/enrollments.ts`.

- Add `import { requireAuth } from "../middleware/auth"`
- Add `requireAuth` before `asyncHandler(...)` on every route in the file

## Task 7: Protect `src/routes/metrics.ts`

Modify `perfxcel-api/src/routes/metrics.ts`.

- Add `import { requireAuth } from "../middleware/auth"`
- Replace the `// TODO: Add requireAuth middleware before going to production` comment with the actual middleware
- Updated route: `router.get("/", requireAuth, asyncHandler(getDashboardMetrics))`

## Task 8: Unit Tests for `requireAuth`

Create `perfxcel-api/src/__tests__/middleware/auth.test.ts`.

- The test runner is **Jest** with `ts-jest` — use `jest.mock`, `jest.fn()`, `beforeEach`, `afterEach`
- Mock the supabase module: `jest.mock("../../db/supabase", () => ({ supabase: { auth: { getUser: jest.fn() } } }))`
- Import the mock after mocking: `import { supabase } from "../../db/supabase"`
- Test cases (one `it` block per case):
  1. **Missing header** — call `requireAuth` with no `authorization` header → verify it throws or calls `next` with an `AuthenticationError`
  2. **Malformed header** — `authorization: "Token abc123"` → verify `AuthenticationError`
  3. **Supabase returns error** — mock `getUser` to return `{ data: { user: null }, error: { message: "JWT expired" } }` → verify `AuthenticationError`
  4. **Valid token** — mock `getUser` to return `{ data: { user: { id: "user-1", email: "a@b.com" } }, error: null }` → verify `next()` is called and `req.user` is the mocked user
  5. **Dev bypass** — `supabaseConfigured` is computed at module load time, so use `jest.resetModules()` + `jest.isolateModules()` with `delete process.env.SUPABASE_URL` before re-importing the middleware → verify `next()` is called without calling `supabase.auth.getUser`; restore env vars in `afterEach`

**Helper for constructing mock Express objects:**
```typescript
const mockReq = (headers: Record<string, string> = {}) =>
  ({ headers } as unknown as Request);
const mockRes = {} as Response;
const mockNext = jest.fn();
```

Since `requireAuth` is `async` and throws (rather than calling `next(err)`), wrap calls in `try/catch` or use `await expect(requireAuth(req, res, next)).rejects.toThrow(...)` to assert the thrown error.

## Task 9: Verify TypeScript

Run `tsc -b` from `perfxcel-api/` and confirm zero type errors. Fix any errors before marking complete.
