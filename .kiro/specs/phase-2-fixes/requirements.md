# Requirements
## Perfxcel Phase 2 — File Uploads, Audit Logs, Filters & Course Overview

**Scope:** `perfxcel-api` · `perfxcel-admin` · `perfxcel-app` · `dot-portal-api`

---

## 1. File Uploads — Training Plan & Course Brochure (Bug Fix)

### Actual root cause
The `supabase` client in `perfxcel-admin` is created with the **anon key** (`VITE_SUPABASE_ANON_KEY`). Storage RLS policies gate writes by role:

| Bucket | INSERT policy | Allows |
|---|---|---|
| `assets` | `service_role` only | Anon client always 403 |
| `course-images` | `authenticated` role | Works only if JWT is in scope |
| `course-brochures` | `authenticated` role | Works only if JWT is in scope |

`Settings.tsx` uploads to `assets` — an anon client can never write there regardless of whether the admin is logged in, because the anon client does not carry the user's session JWT in storage requests unless `setSession` is called explicitly. The Supabase JS SDK wraps the resulting 403 as "Failed to fetch".

`CourseForm.tsx` has a secondary issue: brochures are uploaded to `course-images` (wrong bucket) because of an inline comment left in the code: `// Using course-images bucket for all assets for simplicity or create course-brochures`.

Additionally, `CourseForm.tsx` uses `import("../lib/supabase")` as a dynamic import inside `handleSubmit` — the singleton is loaded lazily after the form is submitted, which is unnecessary but not the primary cause of failure.

### Solution
The Supabase anon client is the wrong tool for admin storage writes. Two options:

**Option A (minimal):** Call `supabase.auth.setSession(session)` before any storage call so the client carries the user JWT, then add an `authenticated` INSERT policy on the `assets` bucket.

**Option B (correct for architecture):** Route storage writes through `perfxcel-api`, which uses the service-role client and has no RLS constraints. The frontend POSTs the file as `multipart/form-data` to the API; the API writes to storage and returns the URL. This is the pattern consistent with how the rest of the platform handles server-side storage operations. Image upload already works (it uses the auth session correctly via a static import), so this fix is scoped to the two failing cases: training plan PDF and course brochure PDF.

**Decision: Option B for PDFs, fix the bucket name for brochure.** Course images already work and don't need changing. Training plan PDF and course brochure PDF go through the API.

### User stories
- As an admin, I can upload a training plan PDF in the Settings page without a "Failed to fetch" error.
- As an admin, I can upload a course brochure PDF in the Course Editor without a "Failed to fetch" error.
- As an admin, the uploaded brochure is stored in the correct `course-brochures` bucket, not `course-images`.

### Acceptance criteria
- AC1: `POST /api/v1/upload/training-plan` (protected, `requireAuth` + `requirePerfxcelTenant`) accepts `multipart/form-data` with field `file` (PDF, max 20MB). Writes to the `assets` bucket as `training_plan.pdf` with `upsert: true` using the service-role Supabase client. Returns `{ status: "success", data: { url: string } }`.
- AC2: `POST /api/v1/upload/course-brochure` (protected) accepts `multipart/form-data` with fields `file` (PDF, max 20MB) and `short_code` (string). Writes to the `course-brochures` bucket as `${short_code}.pdf`. Returns `{ status: "success", data: { url: string } }`.
- AC3: Both endpoints validate MIME type and size before writing to storage. Wrong type → 400; file too large → 413.
- AC4: Both endpoints use `multer` with `memoryStorage()`. No temp files on disk.
- AC5: A new `src/routes/upload.ts` registers both routes. Mounted in `app.ts` as `app.use("/api/v1/upload", uploadRoutes)`.
- AC6: `Settings.tsx` — upload handler replaced: calls `api.post("/upload/training-plan", formData)` using the existing JWT-bearing `api` Axios instance. Removes the `supabase.storage` call and the `supabase` import.
- AC7: `Settings.tsx` — download handler replaced: calls `GET /api/v1/upload/training-plan/download` which generates a signed URL on the backend and returns it, or redirects directly. Removes `supabase.storage.createSignedUrl` call.
- AC8: `api.ts` in `perfxcel-admin` gains `uploadTrainingPlan(file: File)` and `uploadCourseBrochure(file: File, shortCode: string)` and `downloadTrainingPlan()` functions.
- AC9: `CourseForm.tsx` — brochure upload uses `uploadCourseBrochure` from `api.ts` instead of direct `supabase.storage`. The `course-brochures` bucket name is used (not `course-images`).
- AC10: The `supabase` dynamic import in `CourseForm.tsx` is retained only for course image uploads (which already work), or optionally replaced with a static import.
- AC11: `GET /api/v1/upload/training-plan/download` (protected) generates a 60-second signed URL from the `assets` bucket and returns `{ status: "success", data: { signedUrl: string } }`.

---

## 2. Audit Logs Not Updating (Bug Fix)

### Actual root cause — two independent bugs

**Bug A (controller-level logging — `auditLogger.ts`):**
`logAuditEvent()` posts to `${portalUrl}/api/v1/audit/logs/ingest`. The portal mounts its audit router at `/api/v1/audit-logs` — no sub-path. Every controller-level audit event has been hitting a 404 since `auditLogger.ts` was written. These events have never been persisted.

**Bug B (portal validation — `ingestAuditLogsSchema`):**
Even if the path were correct, the portal's Zod schema requires `actorType: z.enum(["user", "service"])`. The body sent by `logAuditEvent` includes `action`, `entityType`, `entityId`, `actorId`, `actorEmail`, `details`, `timestamp` but **does not include `actorType`**. Zod validation rejects the request before it reaches the controller. The error is swallowed by the `try/catch` in `logAuditEvent`.

**Bug C (proxy-level logging — `routes/auditLogs.ts`):**
The admin frontend reads logs through `perfxcel-api/src/routes/auditLogs.ts`, which forwards the user's JWT to dot-portal-api. The portal's `authenticate` middleware validates the JWT and reads `activeTenantId` from `app_metadata`. Since the access control refactor, the admin user's token may not have `activeTenantId` correctly populated for the portal's tenant model, causing `resolveTenant` to fail silently. The proxy swallows the 4xx response and returns a generic 502 to the frontend.

### Solution
Fix all three bugs independently:
- A: Correct the URL in `auditLogger.ts`.
- B: Add `actorType` to every `logAuditEvent` call and to the `AuditEventParams` interface.
- C: The proxy should forward `x-tenant-id` and use a service-level mechanism so the portal doesn't need to validate the user's JWT a second time. The simplest fix is for the proxy to pass the `tenantId` header and rely on the portal accepting requests with `x-tenant-id` from trusted internal services.

### User stories
- As an admin viewing Audit Logs, I see events since the fix was deployed.
- As a developer, audit log write failures surface as warnings in the Sentry trail rather than disappearing silently.

### Acceptance criteria
- AC1: `auditLogger.ts` — URL corrected to `${portalUrl}/api/v1/audit-logs`.
- AC2: `AuditEventParams` interface gains `actorType: "user" | "service"` (required field).
- AC3: All `logAuditEvent()` calls in controllers are updated: public-route calls (no `req.user`) use `actorType: "service"`; admin-route calls use `actorType: "user"`.
- AC4: The `events` array body now matches `ingestAuditLogsSchema`: each event includes `tenantId`, `action`, `actorId`, `actorType`, `timestamp`. Existing `entityType`, `entityId`, `details` fields map correctly.
- AC5: `routes/auditLogs.ts` proxy — when the portal returns a non-2xx response, the actual response body and status code are logged (via `logger.warn` or Sentry breadcrumb) before the 502 is thrown, so failures are debuggable.
- AC6: After deploying, new actions (course update, status change, form submission) appear in the Admin Audit Logs page.

---

## 3. Course Overview Field (New Feature)

### What
A new `overview` TEXT column on `perfxcel.courses` for a freeform narrative overview of the course, separate from the structured `description`, `objectives`, and `target_audience` fields. Rendered on the public course detail page above the objectives section.

### Decision — plain textarea, no WYSIWYG
No new npm packages. `overview` is a `<textarea>` in the admin and rendered as pre-wrapped text on the public site. The Smart Paste parser for `course_outline` is a separate ticket.

### User stories
- As an admin, I can write a course overview in the Course Editor and save it.
- As a visitor, I see the overview on the course detail page.

### Acceptance criteria
- AC1: `ALTER TABLE perfxcel.courses ADD COLUMN IF NOT EXISTS overview TEXT DEFAULT NULL` added to master migration.
- AC2: `courseInputSchema` gains `overview: z.string().trim().max(5000).optional().nullable()`.
- AC3: `GET /api/v1/courses/:id` and `GET /api/v1/courses` include `overview` in the response (via `*` select — no query change needed).
- AC4: `CourseFormValues` in `src/validators/courseFormSchema.ts` (`perfxcel-admin`) gains `overview: z.string().optional().nullable()`.
- AC5: `CourseForm.tsx` gains an "Overview" `<textarea>` in the Basic Info section (after Description), wired via `register("overview")`. Character count displayed (max 5000).
- AC6: `Course` interface in `perfxcel-admin/src/lib/api.ts` gains `overview?: string | null`.
- AC7: `Course` interface in `perfxcel-app/src/types/course.ts` gains `overview?: string | null`.
- AC8: `CourseDetail.tsx` renders an "Overview" section when `course.overview` is non-empty, placed between the hero image and the objectives/target-audience grid.
- AC9: Overview text is rendered with `whitespace-pre-wrap` to preserve line breaks.

---

## 4. Consistent Search & Filters Across Admin Data Pages (New Feature)

### What
The four data pages (Enquiries, Interests, Enrollments, Training Plans) each have ad-hoc filter bars. Enquiries uses a form-submit search with no status dropdown. Training Plans uses form-submit search with no date filter. None have a date range filter. Build a shared `FilterBar` component and apply it consistently.

### User stories
- As an admin, I have a consistent filter experience across all data pages.
- As an admin, I can filter any list by date range.

### Acceptance criteria
- AC1: `src/components/FilterBar.tsx` accepts props: `search`, `onSearchChange`, `statusOptions?: { label: string; value: string }[]`, `status?`, `onStatusChange?`, `dateFrom?`, `onDateFromChange?`, `dateTo?`, `onDateToChange?`, `onClear`, `children?` (for page-specific extras like the course dropdown in Interests).
- AC2: Text search is debounced 300ms inside `FilterBar` using a `useEffect`+`setTimeout` pattern.
- AC3: An "Active filters" indicator badge appears in the `FilterBar` when any filter differs from its default.
- AC4: `Enquiries.tsx` replaces the `<form onSubmit>` search with `FilterBar`. Adds status options `new` / `responded`.
- AC5: `Interests.tsx` replaces its existing filter row with `FilterBar`. The course `<select>` is passed as `children`.
- AC6: `Enrollments.tsx` replaces its filter row with `FilterBar`.
- AC7: `TrainingPlanRequests.tsx` replaces its `<form onSubmit>` with `FilterBar`. Expiry status filter (`all` / `valid` / `expired`) is applied client-side after fetch (the API doesn't return a computed "expired" status — it's derived from `expires_at < now()`).
- AC8: Date range filters (`date_from`, `date_to`) are forwarded as ISO strings to the API for Enquiries, Interests, and Training Plans.
- AC9: `getInterests`, `getEnquiries`, `getTrainingPlanRequests` in `perfxcel-admin/src/lib/api.ts` have their param types updated to include `date_from?: string; date_to?: string`.
- AC10: `getInterests`, `getEnquiries`, `getTrainingPlanRequests` controllers in `perfxcel-api` apply `.gte("created_at", date_from)` and `.lte("created_at", date_to)` when those params are present.


---

## 5. Unified "Register Interest & Download Brochure" Flow (New Feature)

### Context from the code

The sidebar on `CourseDetail.tsx` currently has two separate buttons:
1. **Register Interest** → opens `RegisterInterestModal` → calls `submitCourseInterest` (no brochure)
2. **Download Brochure** → opens `BrochureModal` → calls `requestBrochure` → `POST /courses/:id/brochure`

The backend already supports a unified path: `registerInterest` in `courseController.ts` checks `request_brochure: true` in the validated body, generates a brochure token, and sends the email if the course has a `brochure_url`. This was built in the previous sprint but was never wired to the frontend.

The `POST /courses/:id/brochure` endpoint and `BrochureModal` component are a duplicate path that bypasses the interest record entirely. They should be removed.

### What changes

When a course has a `brochure_url`:
- The "Register Interest" button label becomes **"Register Interest & Download Brochure"**
- The separate "Download Brochure" button is removed
- The `RegisterInterestModal` submits with `request_brochure: true`, triggering the existing backend brochure email logic
- Success message confirms both: interest registered and brochure emailed
- A visitor still gets a brochure email by filling one form, not two

When a course has **no** `brochure_url`, the button stays "Register Interest" and behaviour is unchanged.

### User stories
- As a visitor on a course page with a brochure, I see a single "Register Interest & Download Brochure" button instead of two separate buttons.
- After submitting the form, I receive one confirmation and the brochure PDF is emailed to me automatically.
- As a visitor on a course page without a brochure, I see the regular "Register Interest" button with unchanged behaviour.

### Acceptance criteria
- AC1: `RegisterInterestModal` accepts a new optional prop `sendBrochure?: boolean`.
- AC2: When `sendBrochure` is true, `submitCourseInterest` is called with `request_brochure: true` appended to the data payload.
- AC3: The success message in `RegisterInterestModal` conditionally reads "Thank you! We've received your details and sent the course brochure to your email." when `sendBrochure` is true, and "Thank you! We've received your details." otherwise.
- AC4: `CourseDetail.tsx` passes `sendBrochure={!!course.brochure_url}` to `RegisterInterestModal`.
- AC5: The "Register Interest" button label in `CourseDetail.tsx` sidebar is conditionally `"Register Interest & Download Brochure"` when `course.brochure_url` is set, `"Register Interest"` otherwise.
- AC6: The separate "Download Brochure" button in the sidebar is removed.
- AC7: `showBrochureModal` state and the `BrochureModal` render are removed from `CourseDetail.tsx`.
- AC8: `BrochureModal.tsx` component is deleted.
- AC9: `requestBrochure` function is removed from `perfxcel-app/src/api.ts`.
- AC10: `POST /courses/:id/brochure` endpoint and its handler are removed from `perfxcel-api` (the unified flow goes through `POST /courses/:id/interest` with `request_brochure: true`).
- AC11: The existing `interestSchema` already validates `request_brochure: z.boolean().optional().default(false)` — no schema change needed.
- AC12: `submitCourseInterest` in `perfxcel-app/src/api.ts` is updated to accept an optional `request_brochure` flag: `data: { name, email, phone?, company?, request_brochure?: boolean }`.
