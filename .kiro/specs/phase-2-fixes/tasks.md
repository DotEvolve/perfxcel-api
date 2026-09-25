# Implementation Tasks
## Perfxcel Phase 2 — File Uploads, Audit Logs, Filters & Course Overview

Tasks are grouped by dependency. Groups at the same level can run in parallel.

---

## Group 0 — Dependencies

### T0.1 · Install multer in `perfxcel-api`
```bash
cd perfxcel-api && npm install multer && npm install --save-dev @types/multer
```
Verify `multer` and `@types/multer` appear in `package.json`.

---

## Group 1 — Database (unblocks all other groups)

### T1.1 · Add `overview` column to courses table
Add to `dot-portal-api/supabase/migrations/20260912000000_perfxcel_master.sql`:
- In the `CREATE TABLE perfxcel.courses` block: `overview TEXT DEFAULT NULL,`
- Below the existing `ALTER TABLE perfxcel.courses ADD COLUMN IF NOT EXISTS ...` block: `ADD COLUMN IF NOT EXISTS overview TEXT DEFAULT NULL`
- **Repo:** `dot-portal-api`

### T1.2 · Apply migration to dev database
- Connect to dev server via `ssh dev`
- Run: `ALTER TABLE perfxcel.courses ADD COLUMN IF NOT EXISTS overview TEXT DEFAULT NULL;`
- Verify with `\d perfxcel.courses`

---

## Group 2 — Backend: Upload Endpoints (`perfxcel-api`)

Depends on: T0.1, T1.2

### T2.1 · Create `src/controllers/uploadController.ts`
Implement three exported functions as per design section 1.1:
- `uploadTrainingPlan` — writes to `assets` bucket as `training_plan.pdf` (upsert); returns download URL
- `downloadTrainingPlan` — generates 60-second signed URL from `assets` bucket; returns `{ signedUrl }`
- `uploadCourseBrochure` — writes to `course-brochures` bucket as `${short_code}.pdf`; returns public URL
All use `perfxcelSupabase` (service-role client) — no RLS issue.
- **Files:** `src/controllers/uploadController.ts`

### T2.2 · Create `src/routes/upload.ts`
Wire multer middleware + all three controllers:
- `POST /training-plan` — `pdfUpload.single("file")` + `uploadTrainingPlan`
- `GET /training-plan/download` — `downloadTrainingPlan`
- `POST /course-brochure` — `pdfUpload.single("file")` + `uploadCourseBrochure`
All protected: `requireAuth` + `requirePerfxcelTenant`.
- **Files:** `src/routes/upload.ts`

### T2.3 · Register upload routes in `src/app.ts`
```typescript
import uploadRoutes from "./routes/upload";
app.use("/api/v1/upload", uploadRoutes);
```
- **Files:** `src/app.ts`

### T2.4 · Build verification
```bash
cd perfxcel-api && npm run build
```
Must exit 0 with no TypeScript errors.

---

## Group 3 — Backend: Audit Log Fixes (`perfxcel-api`)

Can run in parallel with Group 2.

### T3.1 · Fix URL in `src/utils/auditLogger.ts`
Change the fetch URL:
```
BEFORE: ${portalUrl}/api/v1/audit/logs/ingest
AFTER:  ${portalUrl}/api/v1/audit-logs
```
- **Files:** `src/utils/auditLogger.ts`

### T3.2 · Add `actorType` to `AuditEventParams` and event body
- Add `actorType: "user" | "service"` as required field to the `AuditEventParams` interface
- Add `actorType: params.actorType` to the `events[0]` body sent to the portal
- **Files:** `src/utils/auditLogger.ts`

### T3.3 · Update all `logAuditEvent` call sites with `actorType`
Using the controller table in design section 2.2, add `actorType: "user"` or `actorType: "service"` to every `logAuditEvent({...})` call:
- `actorType: "service"` — `registerInterest`, `requestTrainingPlan`, `submitContact`
- `actorType: "user"` — all remaining calls in `courseController`, `interestController`, `enrollmentController`, `trainingPlanController`, `settingsController`
- **Files:** `src/controllers/courseController.ts`, `src/controllers/interestController.ts`, `src/controllers/enrollmentController.ts`, `src/controllers/trainingPlanController.ts`, `src/controllers/settingsController.ts`, `src/controllers/enquiryController.ts`

### T3.4 · Surface errors in `src/routes/auditLogs.ts` proxy
In both the POST and GET handlers, when `!response.ok`:
- Parse the response body
- Log it with `console.error("[auditLogs proxy] Portal returned", response.status, data)` before returning the error response
- **Files:** `src/routes/auditLogs.ts`

### T3.5 · Build verification
```bash
cd perfxcel-api && npm run build
```

---

## Group 4 — Backend: Course Overview & Date Filters (`perfxcel-api`)

Can run in parallel with Groups 2 and 3.

### T4.1 · Add `overview` to `courseInputSchema` in `src/validators/schemas.ts`
```typescript
overview: z.string().trim().max(5000).optional().nullable(),
```
- **Files:** `src/validators/schemas.ts`

### T4.2 · Add date filters to Enquiries, Interests, Training Plans controllers
In `getEnquiries`, `getInterests`, `getTrainingPlanRequests`:
```typescript
const { date_from, date_to } = req.query;
if (date_from) query = query.gte("created_at", String(date_from));
if (date_to)   query = query.lte("created_at", String(date_to));
```
- **Files:** `src/controllers/enquiryController.ts`, `src/controllers/interestController.ts`, `src/controllers/trainingPlanController.ts`

---

## Group 5 — Admin Frontend (`perfxcel-admin`)

Depends on: T2.4, T3.5, T4.2

### T5.1 · Add upload/download functions to `src/lib/api.ts`
Add three new exported functions as per design section 1.2:
- `uploadTrainingPlan(file: File): Promise<{ url: string }>`
- `downloadTrainingPlanUrl(): Promise<string>`
- `uploadCourseBrochure(file: File, shortCode: string): Promise<{ url: string; filename: string }>`
Update `getEnquiries`, `getInterests`, `getTrainingPlanRequests` param types to include `date_from?: string; date_to?: string`.
- **Files:** `src/lib/api.ts`

### T5.2 · Fix `Settings.tsx` — replace direct Supabase storage calls
- Upload: replace `supabase.storage.from("assets").upload(...)` with `uploadTrainingPlan(file)`
- Download: replace `supabase.storage.from("assets").createSignedUrl(...)` + `window.open(...)` with `downloadTrainingPlanUrl()` + `window.open(signedUrl, "_blank")`
- Remove `import { supabase } from "../lib/supabase"` if no longer used in the file
- **Files:** `src/pages/Settings.tsx`

### T5.3 · Fix `CourseForm.tsx` — brochure upload through API
- Replace the brochure `supabase.storage.from("course-images").upload(...)` call with `uploadCourseBrochure(brochureFile, values.short_code)`
- Store the returned URL via `setValue("brochure_url", result.url)`
- The bucket name in the comment is corrected automatically since the API call handles the bucket name
- The course image upload via dynamic `import("../lib/supabase")` is left unchanged (it works)
- **Files:** `src/components/CourseForm.tsx`

### T5.4 · Add `overview` to `CourseFormValues` and `CourseForm.tsx` UI
- Add `overview: z.string().trim().max(5000).optional().nullable()` to `src/validators/courseFormSchema.ts`
- Add `overview: null` to `useForm` default values
- Add `overview: course.overview ?? null` to the `reset()` call in the edit mode `useEffect`
- Add the Overview `<textarea>` to the Basic Info section (after Description, before Objectives), using `register("overview")` and `watch("overview")` for character count
- **Files:** `src/validators/courseFormSchema.ts`, `src/components/CourseForm.tsx`

### T5.5 · Add `overview` to `Course` interface in `src/lib/api.ts`
```typescript
overview?: string | null;
```
- **Files:** `src/lib/api.ts`

### T5.6 · Create `src/components/FilterBar.tsx`
Implement the shared filter bar component as per design section 4.1:
- Debounced search (300ms)
- Optional status dropdown
- Optional date range inputs
- Active filters indicator + clear button
- `children` prop for page-specific extras
- **Files:** `src/components/FilterBar.tsx`

### T5.7 · Refactor `Enquiries.tsx` with FilterBar
- Add state: `status`, `dateFrom`, `dateTo`
- Replace `<form onSubmit>` search with `<FilterBar ...>`
- Pass date range and status to `getEnquiries()`
- **Files:** `src/pages/Enquiries.tsx`

### T5.8 · Refactor `Interests.tsx` with FilterBar
- Remove existing filter row (search input + status select + course select)
- Replace with `<FilterBar ...>` with course `<select>` passed as `children`
- Add date range state and pass to `getInterests()`
- **Files:** `src/pages/Interests.tsx`

### T5.9 · Refactor `Enrollments.tsx` with FilterBar
- Replace existing filter row with `<FilterBar ...>`
- Date range applied client-side if not adding backend support
- **Files:** `src/pages/Enrollments.tsx`

### T5.10 · Refactor `TrainingPlanRequests.tsx` with FilterBar
- Replace `<form onSubmit>` with `<FilterBar ...>`
- Add `expiryStatus` state (`"all"` / `"valid"` / `"expired"`); apply client-side filter on `expires_at` after fetch
- Pass date range to `getTrainingPlanRequests()`
- **Files:** `src/pages/TrainingPlanRequests.tsx`

### T5.11 · Admin build verification
```bash
cd perfxcel-admin && npm run build
```
Must exit 0.

---

## Group 6 — Public App (`perfxcel-app`)

Can run in parallel with Group 5.

### T6.1 · Add `overview` to `Course` interface in `src/types/course.ts`
```typescript
overview?: string | null;
```
- **Files:** `src/types/course.ts`, `src/types/index.ts`

### T6.2 · Render Overview section in `CourseDetail.tsx`
Insert between the description prose block and the objectives/target-audience grid:
```tsx
{course.overview && (
  <div className="mb-12">
    <h2 className="font-bold text-secondary-900 text-2xl mb-4">Overview</h2>
    <p className="text-secondary-700 leading-relaxed whitespace-pre-wrap text-lg">
      {course.overview}
    </p>
  </div>
)}
```
- **Files:** `src/pages/CourseDetail.tsx`

### T6.3 · Public app build verification
```bash
cd perfxcel-app && npm run build
```
Must exit 0.

---

## Group 7 — Smoke Tests

Depends on all previous groups deployed to dev.

### T7.1 · Upload training plan PDF
- In Settings, click "Upload New Plan", select a PDF → confirm no error, success message shown
- Click "Download Current Plan" → confirm signed URL opens in new tab
- Verify file exists in Supabase Storage `assets` bucket

### T7.2 · Upload course brochure
- Edit a course with a `short_code`, upload a PDF as brochure → confirm no error
- Navigate to the course public page → confirm "Download Brochure" button appears
- Click Download Brochure → confirm the brochure modal works and email fires
- Verify file exists in `course-brochures` bucket (not `course-images`)

### T7.3 · Audit logs resume
- Update a course title in the admin
- Open Admin → Audit Logs → confirm a `COURSE_UPDATED` event appears with timestamp after the fix
- Check `actorType` field is `"user"` in the stored event

### T7.4 · Course overview
- Add an overview to a course in the Admin
- View the public course page → confirm Overview section appears between description and objectives
- Verify it is hidden for courses with no overview

### T7.5 · FilterBar on all data pages
- Enquiries: type a search term → confirm debounced filtering works (no submit button needed)
- Enquiries: filter by status "responded" + a date range → confirm results narrow
- Interests: use FilterBar search + filter by date range
- Training Plans: set Expiry filter to "Expired" → confirm only expired rows shown
- Clear filters on each page → confirm all rows return

---

## Dependency Map

```
T0.1 (multer) → T2.1–T2.4

T1.1 → T1.2 (apply to dev) → T4.1, T4.2

T2.4 (api build) ─┐
T3.5 (api build) ─┤→ T5.x (admin frontend)
T4.2             ─┘

T5.11 (admin build) → T7.x (smoke tests)
T6.3  (app build)   → T7.x (smoke tests)
```

---

## Group 8 — Unified Register Interest & Brochure Flow

Can run in parallel with Groups 2, 3, and 4.

### T8.1 · Remove duplicate brochure endpoint from `perfxcel-api`
- In `src/routes/courses.ts`: remove `router.post("/:id/brochure", ...)` if it exists
- In `src/controllers/courseController.ts`: remove any standalone `requestBrochureHandler` function (not `registerInterest` — that stays)
- **Repos:** `perfxcel-api`

### T8.2 · Update `submitCourseInterest` in `perfxcel-app/src/api.ts`
- Add `request_brochure?: boolean` to the `data` parameter type
- Remove the `requestBrochure` function entirely
- **Files:** `perfxcel-app/src/api.ts`

### T8.3 · Update `RegisterInterestModal.tsx`
- Add `sendBrochure?: boolean` prop to the interface
- Pass `request_brochure: sendBrochure ?? false` in the `submitCourseInterest` call
- Show conditional success message based on `sendBrochure`
- **Files:** `perfxcel-app/src/components/RegisterInterestModal.tsx`

### T8.4 · Update `CourseDetail.tsx`
- Remove `showBrochureModal` state
- Remove `BrochureModal` import
- Remove the separate "Download Brochure" button JSX
- Remove the `<BrochureModal ... />` render
- Update "Register Interest" button label: conditional on `course.brochure_url`
- Pass `sendBrochure={!!course.brochure_url}` to `<RegisterInterestModal />`
- Remove unused `Download` lucide import if no longer needed
- **Files:** `perfxcel-app/src/pages/CourseDetail.tsx`

### T8.5 · Delete `BrochureModal.tsx`
- Delete `perfxcel-app/src/components/BrochureModal.tsx`
- **Files:** `perfxcel-app/src/components/BrochureModal.tsx` (delete)

### T8.6 · Build verifications
```bash
cd perfxcel-api  && npm run build   # confirm no TS errors
cd perfxcel-app  && npm run build   # confirm no TS errors
```

### T8.7 · Smoke test
- Navigate to a course page that has `brochure_url` set
- Confirm only one button: "Register Interest & Download Brochure" (no separate "Download Brochure" button)
- Submit the form → confirm interest is registered in admin Interests page with brochure badge
- Confirm brochure email arrives in the submitted email address
- Navigate to a course without `brochure_url` → confirm button reads "Register Interest" only
