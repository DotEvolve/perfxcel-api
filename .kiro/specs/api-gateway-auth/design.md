# API Gateway Auth — Design

## New Files

```
src/
├── middleware/
│   └── auth.ts          ← requireAuth middleware
└── types/
    └── express.d.ts     ← req.user type augmentation
```

---

## `src/types/express.d.ts`

Declares `req.user` as optional so that unprotected routes (which don't run `requireAuth`) still type-check without needing a non-null assertion.

```typescript
import type { User } from "@supabase/supabase-js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}
```

This file has no exports — it is a pure ambient declaration. TypeScript picks it up automatically via the `tsconfig.json` `include` glob.

---

## `src/middleware/auth.ts`

```typescript
import { Request, Response, NextFunction } from "express";
import { supabase } from "../db/supabase";
import { AuthenticationError } from "@dotevolve/error-utils";

const supabaseConfigured =
  Boolean(process.env.SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  // Development bypass — never remove this guard
  if (!supabaseConfigured) {
    console.warn("[requireAuth] Supabase not configured — skipping auth (dev only)");
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthenticationError("Missing or malformed Authorization header");
  }

  const token = authHeader.slice(7); // strip "Bearer "

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new AuthenticationError("Invalid or expired token");
  }

  req.user = data.user;
  next();
};
```

Design notes:
- `supabaseConfigured` is evaluated once at module load time — not on every request — avoiding repeated `process.env` reads.
- `AuthenticationError` from `@dotevolve/error-utils` maps to HTTP 401. `asyncHandler` in route files will catch thrown errors and forward them to `errorHandlerMiddleware`.
- The middleware itself is `async` so it can `await supabase.auth.getUser`. But it is NOT wrapped in `asyncHandler` here — it is applied directly in route files. Each route file must either wrap it in `asyncHandler` or handle the `async` throw with the framework's error propagation. Since Express 5 handles async middleware rejections natively, no wrapper is needed.
- `console.warn` is used for the dev bypass warning — this is an acceptable deviation since it's a non-production code path.

---

## Route-File Application Pattern

`requireAuth` is added as route-level middleware, not app-level. This allows per-route exemptions (e.g. `POST /:id/interest`).

### `src/routes/courses.ts` — example

```typescript
import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { getCourses, getCourse, createCourse, updateCourse, deleteCourse, registerInterest, bulkUpdateCourses } from "../controllers/courseController";

const router = Router();

// Public — tenant-facing interest registration
router.post("/:id/interest", asyncHandler(registerInterest));

// Admin routes — require JWT
router.get("/", requireAuth, asyncHandler(getCourses));
router.get("/:id", requireAuth, asyncHandler(getCourse));
router.post("/", requireAuth, asyncHandler(createCourse));
router.put("/:id", requireAuth, asyncHandler(updateCourse));
router.patch("/bulk", requireAuth, asyncHandler(bulkUpdateCourses));
router.delete("/:id", requireAuth, asyncHandler(deleteCourse));

export default router;
```

Note: `POST /:id/interest` is registered **before** the protected routes to avoid ambiguity with `GET /:id`.

### All other protected route files

Apply `requireAuth` as the first argument before `asyncHandler(handler)` on every route:

```typescript
router.get("/", requireAuth, asyncHandler(getHandler));
router.post("/", requireAuth, asyncHandler(createHandler));
// etc.
```

---

## `src/types/` and `tsconfig.json`

The `src/types/express.d.ts` file uses a global declaration. For TypeScript to pick it up, `src/types/` must be included in the TypeScript compilation. Check `tsconfig.json` — if `include` is `["src"]` or broader, no change is needed. If it is more restrictive, add `"src/types/**/*"` to the `include` array.

---

## Authentication Flow

```
Request arrives at protected route
  → requireAuth runs
    → checks SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (both set in production)
    → extracts Bearer token from Authorization header
    → calls supabase.auth.getUser(token)
        (Supabase validates JWT signature + expiry against the project's JWT secret)
    → attaches data.user to req.user
    → calls next()
  → asyncHandler(routeHandler) runs
  → controller accesses req.user if needed
```

---

## Error Response Shape

`AuthenticationError` from `@dotevolve/error-utils` maps to HTTP 401. `errorHandlerMiddleware` formats it as:

```json
{
  "status": "error",
  "message": "Missing or malformed Authorization header"
}
```

---

## Files Changed

| File | Change |
|---|---|
| `src/types/express.d.ts` | **NEW** — `req.user` augmentation |
| `src/middleware/auth.ts` | **NEW** — `requireAuth` middleware |
| `src/routes/courses.ts` | **MODIFY** — add `requireAuth` to all admin routes; keep `POST /:id/interest` public |
| `src/routes/taxonomies.ts` | **MODIFY** — add `requireAuth` to all routes |
| `src/routes/interests.ts` | **MODIFY** — add `requireAuth` to all routes |
| `src/routes/enrollments.ts` | **MODIFY** — add `requireAuth` to all routes |
| `src/routes/metrics.ts` | **MODIFY** — add `requireAuth`; remove the TODO comment |
| `src/__tests__/middleware/auth.test.ts` | **NEW** — unit tests |
