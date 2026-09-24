# Implementation Tasks
## Perfxcel Feature Sprint

**Scope:** `perfxcel-api` · `perfxcel-admin` · `perfxcel-app` · `dot-docs` · Supabase migrations

Tasks are ordered by execution dependency. Groups within the same level can run in parallel.

---

## Group 0 — Dependencies & Packages

These must be done before any code in their respective repos.

### T0.1 · Install `react-hook-form` and `@hookform/resolvers` in `perfxcel-admin`
- **Command:** `npm install react-hook-form @hookform/resolvers`
- **Repo:** `perfxcel-admin`
- **Verify:** both packages appear in `package.json` dependencies; `npm run build` exits 0

---

## Group 1 — Database (all code depends on this)

### T1.1 · Inventory existing migration files
- List all files in `perfxcel-api/supabase/migrations/` (or wherever they live)
- Read each file to capture the full current schema definition
- **Repo:** `perfxcel-api`
- **Output:** mental/noted map of every existing table, column, trigger, RLS policy, and grant

### T1.2 · Add new columns to `courses`
```sql
ALTER TABLE perfxcel.courses
  ADD COLUMN IF NOT EXISTS course_outline JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS brochure_url   TEXT  DEFAULT NULL;
```
- **Repo:** Supabase SQL migration file + master file

### T1.3 · Add new columns to `course_interests`
```sql
ALTER TABLE perfxcel.course_interests
  ADD COLUMN IF NOT EXISTS brochure_token      UUID        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS brochure_expires_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_deleted          BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at          TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_hard_deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hard_deleted_at     TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_course_interests_brochure_token
  ON perfxcel.course_interests(brochure_token)
  WHERE brochure_token IS NOT NULL;
```
- **Repo:** Supabase SQL migration file + master file

### T1.4 · Add new columns to `training_plan_requests`
```sql
ALTER TABLE perfxcel.training_plan_requests
  ADD COLUMN IF NOT EXISTS is_deleted      BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_hard_deleted BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hard_deleted_at TIMESTAMPTZ DEFAULT NULL;
```
- **Repo:** Supabase SQL migration file + master file

### T1.5 · Create `perfxcel.settings` table
```sql
CREATE TABLE IF NOT EXISTS perfxcel.settings (
  setting_key   TEXT PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO perfxcel.settings (setting_key, setting_value) VALUES
  ('training_plan_expiry_days', '180'),
  ('brochure_expiry_days',      '180')
ON CONFLICT DO NOTHING;
```
- **Repo:** Supabase SQL migration file + master file

### T1.6 · Apply migration to dev environment
- Connect to dev server via `ssh dev`
- Run all new column changes against `supabase-db-dev`
- Verify with `\d perfxcel.courses`, `\d perfxcel.course_interests`, `\d perfxcel.training_plan_requests`, `\d perfxcel.settings`
- **Repo:** ops

### T1.7 · Produce consolidated `perfxcel_master.sql`
- Create `perfxcel-api/supabase/migrations/perfxcel_master.sql`
- Incorporate every table, index, trigger, RLS policy, and grant in logical dependency order
- Include all new columns from T1.2–T1.5 inline in the base `CREATE TABLE` blocks
- Move historical migration files to `perfxcel-api/supabase/migrations/archive/`
- Add `perfxcel-api/supabase/migrations/README.md` explaining the apply-from-scratch process and future change authoring policy
- Verify: apply to a blank database and confirm schema matches production
- **Repo:** `perfxcel-api`
- **Files:** `supabase/migrations/perfxcel_master.sql`, `supabase/migrations/README.md`, `supabase/migrations/archive/`

### T1.8 · Apply migration to production
- Connect to prod server via `ssh prod`
- Run all new column changes against `supabase-db-prod`
- Verify schema matches dev
- **Repo:** ops

---

## Group 2 — Backend Infrastructure (no frontend dependency; can parallel with Group 1 after T1.5 schema is applied to dev)

### T2.1 · Create `src/utils/auditLogger.ts`
- `AuditEventParams` interface
- `logAuditEvent(params)` — fire-and-forget, caches `perfxcel` tenant ID on first call via `portalSupabase`
- Early-return when `PORTAL_API_URL` is unset (local dev safety)
- Never throws; swallows all errors
- **Repo:** `perfxcel-api`
- **Files:** `src/utils/auditLogger.ts`

### T2.2 · Create `src/utils/settingsReader.ts`
- `getSetting<T>(key, fallback)` with 5-minute in-process cache
- Reads from `perfxcel.settings` table via existing `supabase` singleton
- **Repo:** `perfxcel-api`
- **Files:** `src/utils/settingsReader.ts`

### T2.3 · Add Zod schemas to `src/validators/schemas.ts`
- `courseOutlineSchema` (nested day → module arrays)
- `manualInterestSchema` (admin create, no Turnstile)
- `manualTrainingPlanSchema` (admin create, no Turnstile)
- `settingsSchema`
- Update existing `interestSchema` — add `request_brochure: z.boolean().optional().default(false)`
- **Repo:** `perfxcel-api`
- **Files:** `src/validators/schemas.ts`

### T2.4 · Update `trainingPlanController.ts` — use configurable expiry
- `requestTrainingPlan`: replace hardcoded 72h with `getSetting("training_plan_expiry_days", 180)` → pass explicit `expires_at` to insert
- Update email copy: compute human-readable duration string (e.g. `180 days → "6 months"`) and use it in the email HTML
- **Repo:** `perfxcel-api`
- **Files:** `src/controllers/trainingPlanController.ts`

---

## Group 3 — Backend Features (depends on Group 1 + Group 2)

### T3.1 · Settings CRUD — new route + controller
- `src/controllers/settingsController.ts`: `getSettings`, `updateSetting`
- `src/routes/settings.ts`: `GET /`, `PATCH /` (both protected)
- Register in `src/app.ts`: `app.use("/api/v1/settings", settingsRoutes)`
- **Repo:** `perfxcel-api`
- **Files:** `src/controllers/settingsController.ts`, `src/routes/settings.ts`, `src/app.ts`

### T3.2 · Course outline — update course controller + routes
- `createCourse` and `updateCourse`: extract `course_outline` from `req.body`, validate with `courseOutlineSchema`, include in Supabase payload
- `routes/courses.ts`: replace inline `validateCourseInput` partial check with full Zod schema for the entire course payload (covering `status`, `is_public`, and now `course_outline`)
- **Repo:** `perfxcel-api`
- **Files:** `src/controllers/courseController.ts`, `src/routes/courses.ts`

### T3.3 · Brochure token generation in `registerInterest`
- After Turnstile validation and DB insert: if `request_brochure: true` and course has `brochure_url`
  - Read `brochure_expiry_days` from settings
  - Generate `crypto.randomUUID()` token
  - Update interest record with `brochure_token` and `brochure_expires_at`
  - Call new `sendBrochureEmail()` private function
  - Fire `logAuditEvent` with `action: "EMAIL_SENT"`, `type: "brochure"`
- Create private `sendBrochureEmail(to, name, courseTitle, downloadUrl)` in `courseController.ts` — nodemailer, same SMTP env vars as certificate email
- **Repo:** `perfxcel-api`
- **Files:** `src/controllers/courseController.ts`

### T3.4 · Brochure download endpoint
- New `downloadBrochure` controller function in `interestController.ts`
  - Lookup by `brochure_token`; 404 if not found
  - Check `brochure_expires_at > NOW()`; 403 with clear message if expired
  - Fetch parent course `brochure_url`; download from `course-brochures` storage bucket
  - Stream response with `Content-Type: application/pdf`, `Content-Disposition: attachment`
- Add to `routes/interests.ts` as first route (before any `/:id` segments): `GET /brochure/:token`
- **Repo:** `perfxcel-api`
- **Files:** `src/controllers/interestController.ts`, `src/routes/interests.ts`

### T3.5 · Interest admin endpoints — manual create, resend brochure, soft delete
- `createInterestManual` controller: validates `manualInterestSchema`, inserts, optionally sends brochure, logs `FORM_SUBMITTED`
- `resendBrochure` controller: fetch interest, check expiry, regenerate token+expiry if expired, update DB, send email, log `EMAIL_SENT` with `{ regenerated }`
- `deleteInterests` controller: body `{ ids }`, soft-delete (`is_deleted=true`), log `RECORD_DELETED`
- Update `getInterests`: add `.eq("is_hard_deleted", false)` unconditionally; add `.eq("is_deleted", false)` unless `include_deleted=true`
- Register all new routes in `routes/interests.ts` (see design section 2.10 for full route file)
- **Repo:** `perfxcel-api`
- **Files:** `src/controllers/interestController.ts`, `src/routes/interests.ts`

### T3.6 · Training plan admin endpoints — manual create, resend, soft delete
- `createTrainingPlanManual` controller: validates `manualTrainingPlanSchema`, reads expiry from settings, inserts with explicit `expires_at`, sends email, logs `FORM_SUBMITTED`
- `resendTrainingPlan` controller: same regeneration + resend pattern as brochure; returns `{ regenerated }`, logs `EMAIL_SENT`
- `deleteTrainingPlans` controller: body `{ ids }`, soft-delete, log `RECORD_DELETED`
- Update `getTrainingPlanRequests`: same double filter as interests
- Register all new routes in `routes/trainingPlan.ts`
- **Repo:** `perfxcel-api`
- **Files:** `src/controllers/trainingPlanController.ts`, `src/routes/trainingPlan.ts`

### T3.7 · Hard delete endpoints — interests and training plans
- `hardDeleteInterest` controller: fetch record, guard against already-erased, anonymise PII fields to `[deleted]`/null, set `is_hard_deleted=true`, `hard_deleted_at=now()`, log `GDPR_ERASURE`
- `hardDeleteTrainingPlan` controller: same pattern; also anonymise `mobile` and `designation`
- Add `POST /:id/hard-delete` to both `routes/interests.ts` and `routes/trainingPlan.ts`
- **Repo:** `perfxcel-api`
- **Files:** `src/controllers/interestController.ts`, `src/controllers/trainingPlanController.ts`, `src/routes/interests.ts`, `src/routes/trainingPlan.ts`

### T3.8 · Audit logging — instrument all controllers
Add `logAuditEvent` calls to:
- `courseController.registerInterest` → `FORM_SUBMITTED` (actor: system)
- `courseController.createCourse` → `COURSE_CREATED`
- `courseController.updateCourse` → `COURSE_UPDATED` (compute `changed_fields` from body keys)
- `trainingPlanController.requestTrainingPlan` → `FORM_SUBMITTED` (actor: system)
- `enquiryController.submitContact` → `FORM_SUBMITTED` (actor: system)
- `interestController.updateInterestStatus` → `INTEREST_STATUS_CHANGED` (include `from`/`to`)
- `enrollmentController.updateEnrollmentStatus` → `ENROLLMENT_STATUS_CHANGED` (include `from`, `to`, `triggered_certificate`)
- `enrollmentController.createEnrollment` → `ENROLLMENT_CREATED`
- `enrollmentController.resendCertificate` → `EMAIL_SENT` (type: "certificate", regenerated: false)
- **Repo:** `perfxcel-api`
- **Files:** `src/controllers/courseController.ts`, `src/controllers/trainingPlanController.ts`, `src/controllers/enquiryController.ts`, `src/controllers/interestController.ts`, `src/controllers/enrollmentController.ts`

### T3.9 · Fix `.env.example` — add all missing variables
Add: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_PERFXCEL_TURNSTILE_SECRET_KEY`, `VITE_PERFXCEL_TURNSTILE_HOSTNAMES`, `PERFXCEL_API_URL`, `PORT`
Replace the example Sentry DSN with a placeholder string
Fix `VITE_TURNSTILE_SECRET_KEY` → `VITE_PERFXCEL_TURNSTILE_SECRET_KEY` (existing mismatch)
- **Repo:** `perfxcel-api`
- **Files:** `.env.example`

### T3.10 · `perfxcel-api` build verification
- `npm run build` — must exit 0 with no TypeScript errors
- **Repo:** `perfxcel-api`

---

## Group 4 — Admin Frontend (`perfxcel-admin`) (depends on Group 3)

### T4.1 · Create `src/validators/courseFormSchema.ts`
- Full Zod schema for `CourseFormValues` as defined in design section 9
- `z.coerce.number()` for `cost`; nested `daySchema` and `moduleSchema`
- **Repo:** `perfxcel-admin`
- **Files:** `src/validators/courseFormSchema.ts`

### T4.2 · Update `src/lib/api.ts` — all new functions and interfaces
- Add `CourseDay`, `CourseModule` interfaces
- Update `Course` interface: add `course_outline?: CourseDay[] | null`, `brochure_url?: string | null`
- Add: `getSettings`, `updateSetting`
- Add: `createTrainingPlanManual`, `resendTrainingPlan`, `deleteTrainingPlans`, `hardDeleteTrainingPlan`
- Add: `createInterestManual`, `resendBrochure`, `deleteInterests`, `hardDeleteInterest`
- **Repo:** `perfxcel-admin`
- **Files:** `src/lib/api.ts`

### T4.3 · Migrate `CourseForm.tsx` to `react-hook-form`
- Replace all ~15 `useState` field declarations with a single `useForm<CourseFormValues>` call using `zodResolver(courseFormSchema)`
- All inputs use `register(...)`, checkboxes use `setValue(...)` or `register(...)` with `type="checkbox"`
- Multi-selects use `setValue(...)` via `onChange` handler (HTML `<select multiple>` + `Array.from(e.target.selectedOptions)`)
- Edit mode: replace individual `setState` calls with a single `reset(courseData)` call
- Keep `imageFile` and `brochureFile` as separate `useState` (File objects are not managed by RHF)
- `handleSubmit` reads from `values` argument instead of individual state variables
- **Repo:** `perfxcel-admin`
- **Files:** `src/components/CourseForm.tsx`

### T4.4 · `CourseForm.tsx` — Course Outline section with `useFieldArray`
- Day-level `useFieldArray({ control, name: "course_outline" })` for append/remove/move
- `SortableDay` sub-component receives `dayIndex`, `control`, `register`, `errors`, `removeDay`; contains per-day module `useFieldArray`
- `@dnd-kit/sortable` `SortableContext` wraps the day list with `verticalListSortingStrategy`
- `handleDragEnd` calls `moveDay(oldIndex, newIndex)` then renumbers `day` fields via `setValue`
- Module rows use `register(\`course_outline.${dayIndex}.modules.${moduleIndex}.title\`)` etc.
- Inline validation errors surfaced from `errors.course_outline?.[i]?.title?.message`
- **Repo:** `perfxcel-admin`
- **Files:** `src/components/CourseForm.tsx`

### T4.5 · `CourseForm.tsx` — Brochure PDF upload
- New `brochureFile: File | null` state
- `<input type="file" accept="application/pdf">` below the Course Image input; client-side size check (max 20MB)
- On submit: if `brochureFile` present, upload to `course-brochures` Supabase Storage bucket as `${short_code}.pdf` (same Supabase Storage pattern as image upload); store resulting public URL in form via `setValue("brochure_url", publicUrl)`
- **Repo:** `perfxcel-admin`
- **Files:** `src/components/CourseForm.tsx`

### T4.6 · New page: `src/pages/Settings.tsx`
- Two `<input type="number">` fields: training plan expiry days, brochure expiry days
- On mount: calls `getSettings()`, pre-fills both inputs
- On save: calls `updateSetting` for each changed field; success/error via inline `Alert` from `@dotevolve/ui-kit`
- Register route `<Route path="/settings" element={<Settings />} />` in `App.tsx` inside `AuthGuard`
- Add "Settings" nav link in `Layout` sidebar
- **Repo:** `perfxcel-admin`
- **Files:** `src/pages/Settings.tsx`, `src/App.tsx`

### T4.7 · `TrainingPlanRequests.tsx` — manual add, bulk delete, resend
- Add state: `selectedIds`, `showAddModal`, `resendingIds`, `resendResults`, `confirmDeleteIds`
- Table: checkbox column prepended; "Resend" button and trash icon in Actions column
- Toolbar: "Add Request" button always visible; red "Delete Selected (n)" appears when selection > 0
- `ManualTrainingPlanModal` inline component: name*, email*, mobile*, designation, company; calls `createTrainingPlanManual`; on success refreshes list
- Per-row resend: calls `resendTrainingPlan(id)`; success message shows "(link regenerated)" if `data.regenerated === true`
- Bulk delete via `ConfirmationModal` (isDestructive) → `deleteTrainingPlans(Array.from(selectedIds))`; single-row delete via trash icon → same modal
- **Repo:** `perfxcel-admin`
- **Files:** `src/pages/TrainingPlanRequests.tsx`

### T4.8 · `TrainingPlanRequests.tsx` — Erase PII button
- Add state: `confirmErase`
- Per-row **Erase PII** `ShieldX` icon (only when `!row.is_hard_deleted`)
- Hard-deleted rows show `ShieldOff` + "Erased" label in name cell
- `ConfirmationModal` (isDestructive): "This will permanently erase all personal data… **This cannot be undone.**"
- On confirm: calls `hardDeleteTrainingPlan(id)`, refreshes list
- Import `ShieldX`, `ShieldOff` from `lucide-react`
- **Repo:** `perfxcel-admin`
- **Files:** `src/pages/TrainingPlanRequests.tsx`

### T4.9 · `Interests.tsx` — manual add, bulk delete, resend brochure, hard delete
- Add state: `selectedIds`, `showAddModal`, `resendingBrochureIds`, `resendBrochureResults`, `confirmDeleteIds`, `confirmErase`
- Checkbox column prepended
- Brochure badge: `FileText` icon in Name cell when `interest.brochure_token` is set
- "Resend Brochure" button: visible when `brochure_token` present; per-row loading/success/error state; calls `resendBrochure(id)`
- `ManualInterestModal`: course dropdown (from existing `courses` state), name*, email*, phone, company, **Send Brochure** checkbox (only shown if selected course has `brochure_url`); calls `createInterestManual`
- Bulk delete + single-row delete: same pattern as Training Plans
- **Erase PII** `ShieldX` icon, same pattern as T4.8; calls `hardDeleteInterest(id)`
- **Repo:** `perfxcel-admin`
- **Files:** `src/pages/Interests.tsx`

### T4.10 · `AuditLogs.tsx` — entity type filter + details column
- Add `entityType?: string` to `AuditLogFilters` in `src/types/auditLog.ts`
- Update `getAuditLogs` in `src/lib/api.ts` to include `entity_type` in `backendFilters`
- Update `useAuditLogs` hook to pass `entityType` through to the API params
- New `<select>` filter in the filter bar alongside existing action filter (options: All, Course, Interest, Enrollment, Training Plan, Enquiry)
- New "Details" table column: `<details>/<summary>` with `<pre>` JSON viewer
- **Repo:** `perfxcel-admin`
- **Files:** `src/pages/AuditLogs.tsx`, `src/types/auditLog.ts`, `src/lib/api.ts`, `src/hooks/useAuditLogs.ts`

### T4.11 · `perfxcel-admin` build verification
- `npm run build` — must exit 0 with no TypeScript errors
- **Repo:** `perfxcel-admin`

---

## Group 5 — Public App (`perfxcel-app`) (depends on Group 3)

### T5.1 · `src/types/course.ts` — add new fields
- Export `CourseDay` and `CourseModule` interfaces
- Add `course_outline?: CourseDay[] | null` and `brochure_url?: string | null` to `Course` interface
- **Repo:** `perfxcel-app`
- **Files:** `src/types/course.ts`, `src/types/index.ts`

### T5.2 · `src/api.ts` — add `requestCourseBrochure`
- Calls `POST /courses/:id/interest` with `{ ...data, turnstileToken, request_brochure: true }`
- Return type: `Promise<void>` (no data needed in success path)
- **Repo:** `perfxcel-app`
- **Files:** `src/api.ts`

### T5.3 · New: `src/components/BrochureModal.tsx`
- Mirrors `RegisterInterestModal.tsx` structure
- Fields: name*, email*, phone, company
- Turnstile with `onExpire` and `onError` handlers (same pattern as `TrainingPlan.tsx`)
- Submit disabled when `!turnstileToken`; button shows spinner when submitting
- On submit: calls `requestCourseBrochure`
- Success state: "Check your email! A download link has been sent to {email}."
- Error handling: `err.response?.data?.message ?? "Failed to submit. Please try again."` — no `AppError instanceof` check
- **Repo:** `perfxcel-app`
- **Files:** `src/components/BrochureModal.tsx`

### T5.4 · `CourseDetail.tsx` — Download Brochure CTA
- Add `showBrochureModal` state
- In sidebar below Register Interest button: conditional `<button>` gated on `course.brochure_url`; uses `FileDown` lucide icon
- Render `<BrochureModal>` at component bottom alongside existing `<RegisterInterestModal>`
- **Repo:** `perfxcel-app`
- **Files:** `src/pages/CourseDetail.tsx`

### T5.5 · `CourseDetail.tsx` — Course Outline accordion
- Insert section between objectives/target-audience grid and schedules table
- Render only when `course.course_outline && course.course_outline.length > 0`
- `<details>/<summary>` per day with `group-open:rotate-180` chevron
- Module rows: title + optional duration right-aligned + optional description
- Import `BookOpen`, `ChevronDown`, `FileDown` into existing import line
- **Repo:** `perfxcel-app`
- **Files:** `src/pages/CourseDetail.tsx`

### T5.6 · `perfxcel-app` build verification
- `npm run build` — must exit 0 with no TypeScript errors
- **Repo:** `perfxcel-app`

---

## Group 6 — Documentation (`dot-docs`) (can start after Group 3 is deployed to dev)

### T6.1 · Create `public/docs/perfxcel/features/course-brochure.md`
- User journey: fill form on course page → receive email → click link → download PDF
- Token expiry behaviour and what happens when a link expires
- Turnstile protection note
- No internal architecture details
- Register in `public/mkdocs.yml` nav under perfxcel → Features

### T6.2 · Create `public/docs/perfxcel/features/link-expiry-settings.md`
- The `perfxcel.settings` table: key names (`training_plan_expiry_days`, `brochure_expiry_days`), valid value ranges
- Admin Settings UI: where to find it, how to change values
- Behaviour note: changes apply to next request only, not retroactive
- Register in `public/mkdocs.yml` nav

### T6.3 · Create `public/docs/perfxcel/features/course-outline.md`
- What the outline is (day-by-day, module-by-module)
- JSONB structure with a worked example
- How admins build it: day add/remove/reorder, module add/remove/edit
- How it renders on the public page (accordion per day)
- Register in `public/mkdocs.yml` nav

### T6.4 · Create `private/docs/perfxcel/architecture/audit-logging.md`
- `logAuditEvent()` utility: location, signature, failure mode
- All event constants table: constant name, trigger, entity type, details shape
- Actor resolution: protected routes vs public form submissions (`actor_id = "system"`)
- How to add a new event type
- Register in `private/mkdocs.yml` nav

### T6.5 · Create `private/docs/perfxcel/architecture/gdpr-erasure.md`
- Anonymisation-over-deletion rationale (FK integrity)
- `is_hard_deleted` flag and erased field list per table
- `GDPR_ERASURE` audit event
- Admin UI flow: where to find Erase PII, two-step confirmation
- Limitation: brochure token links referencing erased records return 403 (token still exists in DB but PII is gone)
- Register in `private/mkdocs.yml` nav

### T6.6 · Update `private/docs/perfxcel/database/schema.md`
- Add all new columns to table reference: `courses`, `course_interests`, `training_plan_requests`
- Add `settings` table definition

### T6.7 · Update (or create) `public/docs/perfxcel/api/endpoints.md`
- Document all new routes from this sprint:
  - `GET  /api/v1/interests/brochure/:token`
  - `POST /api/v1/interests` (admin)
  - `POST /api/v1/interests/:id/resend-brochure`
  - `DELETE /api/v1/interests`
  - `POST /api/v1/interests/:id/hard-delete`
  - `POST /api/v1/training-plan` (admin)
  - `POST /api/v1/training-plan/:id/resend`
  - `DELETE /api/v1/training-plan`
  - `POST /api/v1/training-plan/:id/hard-delete`
  - `GET  /api/v1/settings`
  - `PATCH /api/v1/settings`

### T6.8 · dot-docs build verification
```bash
cd /path/to/dot-docs/public  && mkdocs build   # must exit 0
cd /path/to/dot-docs/private && mkdocs build   # must exit 0
```

---

## Group 7 — Final Smoke Tests (after all groups deployed to dev)

### T7.1 · Brochure flow end-to-end
- Navigate to a course with `brochure_url` set → confirm "Download Brochure" button appears
- Submit form with Turnstile → confirm email arrives with working link
- Click link → confirm PDF downloads
- Wait for expiry (or manually set `brochure_expires_at` to past) → confirm 403 response

### T7.2 · Configurable expiry
- Admin: change `training_plan_expiry_days` to 1 in Settings page → submit new training plan from public site → confirm email link expires after 1 day
- Admin: change value back to 180; confirm old tokens unaffected

### T7.3 · Manual entry + resend
- Admin: add manual Training Plan request → confirm email fires
- Admin: expire a token manually → click Resend → confirm "(link regenerated)" message and new link works
- Admin: add manual Interest with "Send Brochure" checked → confirm brochure email fires without Turnstile

### T7.4 · Soft delete
- Select 3 interests → Delete Selected → confirm `ConfirmationModal` shown → confirm rows removed from list
- Single-row trash icon → confirm modal → confirm row removed
- Repeat for Training Plans
- Verify `include_deleted=true` query param re-surfaces the rows (via Supabase Studio or curl)

### T7.5 · Hard delete (Erase PII)
- Click `ShieldX` on an interest row → confirm two-step modal with warning text
- Confirm → verify row shows `ShieldOff` "Erased" when viewed with `include_deleted=true`
- Verify DB: `name = "[deleted]"`, `email = "[deleted]"`, `is_hard_deleted = true`
- Verify brochure link for that record returns 403 (token lookup finds anonymised email, still 403 on expiry — token is not invalidated by erasure, which is acceptable)
- Repeat for Training Plan

### T7.6 · Course outline
- Create a course with a 2-day outline (2 modules each) → confirm it saves
- Edit the course → confirm outline loads with correct days and modules
- Navigate to public course detail → confirm accordion renders, chevron toggles, modules visible
- Reorder days via drag → confirm day numbers renumber (1, 2) correctly after save

### T7.7 · Audit Logs
- Perform each auditable action (submit interest form, update interest status, create enrollment, mark enrollment achieved, update a course)
- Open Admin → Audit Logs → confirm corresponding events appear
- Filter by entity type "Interest" → confirm only `course_interest` events shown
- Expand Details column → confirm JSON matches expected `details` shape

### T7.8 · react-hook-form validation
- In Course Editor: add a day with no title → try to save → confirm inline validation error "Day title is required"
- Add a module with no title → confirm inline error "Module title is required"
- Submit the full form → confirm saves correctly with outline data included

### T7.9 · dot-docs builds clean
```bash
cd dot-docs/public  && mkdocs build
cd dot-docs/private && mkdocs build
```
Both exit 0.

### T7.10 · DB master migration on fresh database
- Spin up blank Supabase instance
- Apply `perfxcel_master.sql`
- Run `pg_dump --schema-only` and diff against production schema
- Confirm no differences

---

## Dependency Map

```
T0.1 (npm install)
  └─→ T4.1, T4.3, T4.4

T1.1 → T1.2–T1.5 → T1.6 (dev apply)
  └─→ T1.7 (master SQL) → T1.8 (prod apply)

T1.6 + T2.1–T2.4 → T3.1–T3.10

T3.10 (api build) → T4.x (admin frontend)
T3.10            → T5.x (public app)
T3.10 + deployed → T6.x (dot-docs)

T4.11 + T5.6 + T6.8 + T1.8 → T7.x (smoke tests)
```
