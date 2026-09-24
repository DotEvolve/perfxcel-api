# Technical Design
## Perfxcel Feature Sprint

**Scope:** `perfxcel-api` · `perfxcel-admin` · `perfxcel-app` · `dot-docs` · Supabase migrations
All designs are grounded in the actual source code.

---

## 1. Database Changes (Supabase — `perfxcel` schema)

### 1.1 `courses` — add `course_outline` and `brochure_url`

```sql
ALTER TABLE perfxcel.courses
  ADD COLUMN course_outline JSONB DEFAULT NULL,
  ADD COLUMN brochure_url   TEXT  DEFAULT NULL;
```

`brochure_url` stores the path/public URL of the PDF in the `course-brochures` Storage bucket. Null means the Download Brochure button is hidden on the public site.

### 1.2 `course_interests` — brochure token columns + soft-delete

```sql
ALTER TABLE perfxcel.course_interests
  ADD COLUMN brochure_token      UUID        DEFAULT NULL,
  ADD COLUMN brochure_expires_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN is_deleted          BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN deleted_at          TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX idx_course_interests_brochure_token
  ON perfxcel.course_interests(brochure_token)
  WHERE brochure_token IS NOT NULL;
```

### 1.3 `training_plan_requests` — soft-delete columns

```sql
ALTER TABLE perfxcel.training_plan_requests
  ADD COLUMN is_deleted BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
```

The existing DB trigger generates `token` (UUID) and `expires_at`. The application will now pass `expires_at` explicitly at insert time (read from settings) to override the trigger's default.

### 1.4 New `perfxcel.settings` table

```sql
CREATE TABLE perfxcel.settings (
  setting_key   TEXT PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO perfxcel.settings (setting_key, setting_value) VALUES
  ('training_plan_expiry_days', '180'),
  ('brochure_expiry_days',      '180')
ON CONFLICT DO NOTHING;
```

---

## 2. Backend (`perfxcel-api`)

### 2.1 New: `src/utils/auditLogger.ts`

Fire-and-forget helper. Caches the `perfxcel` tenant ID at module scope on first call.

```typescript
interface AuditEventParams {
  tenantId:    string;
  actorId:     string;       // req.user?.id or "system" for public routes
  actorEmail?: string;       // req.user?.email or submitter's email
  action:      string;
  entityType:  string;
  entityId?:   string;
  details?:    Record<string, unknown>;
}

export async function logAuditEvent(params: AuditEventParams): Promise<void> {
  const portalUrl = process.env.PORTAL_API_URL;
  if (!portalUrl) return;
  try {
    await fetch(`${portalUrl}/api/v1/audit-logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action:      params.action,
        entity_type: params.entityType,
        entity_id:   params.entityId,
        actor_id:    params.actorId,
        actor_email: params.actorEmail,
        tenant_id:   params.tenantId,
        details:     params.details ?? {},
      }),
    });
  } catch {
    // intentionally swallowed — audit failure must not break the primary flow
  }
}
```

For protected controllers: `tenantId = req.tenantId`, `actorId = req.user.id`, `actorEmail = req.user.email`.
For public controllers: `actorId = "system"`, `actorEmail = req.body.email`, `tenantId` = cached perfxcel tenant ID (fetch once via `portalSupabase.from("tenants").select("id").eq("slug","perfxcel").single()` on first call).

### 2.2 New: `src/utils/settingsReader.ts`

In-process settings cache with 5-minute TTL. No Redis — settings change rarely.

```typescript
import { supabase } from "../db/supabase";

let cache = new Map<string, unknown>();
let cacheTime = 0;
const TTL_MS = 5 * 60 * 1000;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  if (Date.now() - cacheTime > TTL_MS) {
    const { data } = await supabase
      .from("settings")
      .select("setting_key, setting_value");
    if (data) {
      cache = new Map(data.map((r) => [r.setting_key, r.setting_value]));
      cacheTime = Date.now();
    }
  }
  const val = cache.get(key);
  return val !== undefined ? (val as T) : fallback;
}
```

Usage in `trainingPlanController.ts`:
```typescript
const expiryDays = await getSetting<number>("training_plan_expiry_days", 180);
const expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString();
// pass expires_at explicitly in the insert payload
```

### 2.3 New: `src/routes/settings.ts` + `src/controllers/settingsController.ts`

Routes (both protected):
```typescript
router.get( "/", requireAuth, requirePerfxcelTenant, asyncHandler(getSettings));
router.patch("/", requireAuth, requirePerfxcelTenant,
  validateBody(settingsSchema), asyncHandler(updateSetting));
```

`settingsSchema` (add to `validators/schemas.ts`):
```typescript
export const settingsSchema = z.object({
  setting_key:   z.string().min(1),
  setting_value: z.union([z.number().positive(), z.string(), z.boolean()]),
});
```

`updateSetting` controller:
```typescript
const { setting_key, setting_value } = req.body;
const { error } = await supabase.from("settings")
  .upsert({ setting_key, setting_value, updated_at: new Date().toISOString() });
if (error) throw new AppError(error.message, 500, ErrorCategory.SYSTEM);
res.status(200).json({ status: "success", data: { setting_key, setting_value } });
```

Register in `app.ts`:
```typescript
import settingsRoutes from "./routes/settings";
app.use("/api/v1/settings", settingsRoutes);
```

### 2.4 Zod schema additions (`src/validators/schemas.ts`)

```typescript
// Course outline
const courseModuleSchema = z.object({
  title:       z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  duration:    z.string().trim().max(50).optional(),
});

const courseDaySchema = z.object({
  day:     z.number().int().positive(),
  title:   z.string().trim().min(1).max(200),
  modules: z.array(courseModuleSchema).default([]),
});

export const courseOutlineSchema = z.array(courseDaySchema).optional();

// Admin manual create (no Turnstile)
export const manualInterestSchema = z.object({
  course_id:     z.string().uuid(),
  name:          z.string().trim().min(2).max(100),
  email:         z.string().trim().toLowerCase().email(),
  phone:         z.string().trim().optional(),
  company:       z.string().trim().max(150).optional(),
  send_brochure: z.boolean().optional().default(false),
});

export const manualTrainingPlanSchema = z.object({
  name:        z.string().trim().min(1),
  email:       z.string().trim().toLowerCase().email(),
  mobile:      z.string().trim().min(1),
  designation: z.string().trim().optional(),
  company:     z.string().trim().optional(),
});

// Settings
export const settingsSchema = z.object({
  setting_key:   z.string().min(1),
  setting_value: z.union([z.number().positive(), z.string(), z.boolean()]),
});

// Update existing interestSchema — add request_brochure flag
export const interestSchema = z.object({
  name:             z.string().trim().min(2).max(100),
  email:            z.string().trim().toLowerCase().email(),
  phone:            z.string().trim().optional().or(z.literal("")),
  company:          z.string().trim().max(150).optional(),
  turnstileToken:   z.string().trim().min(1),
  request_brochure: z.boolean().optional().default(false),
});
```

### 2.5 Course outline — changes to `courseController.ts`

`createCourse` and `updateCourse`: extract `course_outline` from `req.body`, validate with `courseOutlineSchema`, include in the Supabase insert/update payload.

`getCourse` / `getCourses`: `course_outline` is returned via `*` select — no change needed.

`routes/courses.ts`: replace the inline `validateCourseInput` with a proper Zod schema covering all fields including `course_outline`.

### 2.6 Brochure flow — changes to `courseController.ts` (`registerInterest`)

When `request_brochure: true` in validated body:

```typescript
// After existing Turnstile validation and DB insert...
if (request_brochure && course.brochure_url) {
  const expiryDays = await getSetting<number>("brochure_expiry_days", 180);
  const brochureToken = crypto.randomUUID(); // Node 24 native — no uuid package needed
  const brochureExpiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString();
  const downloadUrl = `${process.env.PERFXCEL_API_URL}/api/v1/interests/brochure/${brochureToken}`;

  await supabase.from("course_interests")
    .update({ brochure_token: brochureToken, brochure_expires_at: brochureExpiresAt })
    .eq("id", newInterest.id);

  await sendBrochureEmail(email, name, course.title, downloadUrl);
  void logAuditEvent({ ... action: "EMAIL_SENT", entityType: "course_interest", details: { to: email, type: "brochure", regenerated: false } });
}
```

`sendBrochureEmail` — new private function in `courseController.ts`, same nodemailer pattern as `sendCertificateEmail` in `enrollmentController.ts`.

### 2.7 New: `downloadBrochure` controller + route

**Route** (public, no auth — token self-validates):
```typescript
// routes/interests.ts — place BEFORE /:id routes to avoid dynamic capture
router.get("/brochure/:token", asyncHandler(downloadBrochure));
```

**Controller logic:**
1. Find `course_interests` row by `brochure_token`.
2. Check `brochure_expires_at > NOW()` — throw 403 if expired.
3. Fetch parent `courses` row to get `brochure_url`.
4. Download from Supabase Storage `course-brochures` bucket.
5. Stream with `Content-Type: application/pdf` and `Content-Disposition: attachment`.

### 2.8 New interest admin endpoints

**`POST /api/v1/interests`** (protected, manual create):
- Validates `manualInterestSchema`.
- Inserts to `course_interests`.
- If `send_brochure: true` and course has `brochure_url`, calls brochure send logic.
- Logs `FORM_SUBMITTED`.

**`POST /api/v1/interests/:id/resend-brochure`** (protected):
```typescript
// 1. Fetch interest — assert brochure_token IS NOT NULL
// 2. Check brochure_expires_at
const regenerated = new Date(interest.brochure_expires_at) < new Date();
if (regenerated) {
  const expiryDays = await getSetting<number>("brochure_expiry_days", 180);
  const newToken = crypto.randomUUID();
  const newExpiry = new Date(Date.now() + expiryDays * 86_400_000).toISOString();
  await supabase.from("course_interests")
    .update({ brochure_token: newToken, brochure_expires_at: newExpiry })
    .eq("id", id);
  interest.brochure_token = newToken;
}
// 3. Fetch course for title; build download URL; send email
// 4. Log EMAIL_SENT
res.status(200).json({ status: "success", data: { regenerated } });
```

**`DELETE /api/v1/interests`** (protected):
```typescript
const { ids } = req.body; // string[]
if (!Array.isArray(ids) || ids.length === 0)
  throw new AppError("ids array is required", 400, ErrorCategory.VALIDATION);
await supabase.from("course_interests")
  .update({ is_deleted: true, deleted_at: new Date().toISOString() })
  .in("id", ids);
void logAuditEvent({ action: "RECORD_DELETED", entityType: "course_interest",
  details: { ids, count: ids.length } });
res.status(200).json({ status: "success" });
```

`getInterests`: add `.eq("is_deleted", false)` filter unless `req.query.include_deleted === "true"`.

### 2.9 New training plan admin endpoints

**`POST /api/v1/training-plan`** (protected, manual create — no Turnstile):
- Validates `manualTrainingPlanSchema`.
- Reads expiry from settings. Inserts with explicit `expires_at`.
- Sends download email. Logs `FORM_SUBMITTED`.

**`POST /api/v1/training-plan/:id/resend`** (protected):
- Same regeneration pattern as `resendBrochure` above.
- Returns `{ regenerated: boolean }`.
- Logs `EMAIL_SENT`.

**`DELETE /api/v1/training-plan`** (protected):
- Same soft-delete pattern as interests.
- Logs `RECORD_DELETED`.

`getTrainingPlanRequests`: add `.eq("is_deleted", false)` unless `include_deleted=true`.

### 2.10 Updated route files

**`routes/interests.ts`:**
```typescript
router.get(  "/brochure/:token",          asyncHandler(downloadBrochure));       // public
router.get(  "/",  requireAuth, requirePerfxcelTenant, asyncHandler(getInterests));
router.post( "/",  requireAuth, requirePerfxcelTenant,
  validateBody(manualInterestSchema), asyncHandler(createInterestManual));
router.patch("/:id", requireAuth, requirePerfxcelTenant,
  validateBody(interestStatusSchema), asyncHandler(updateInterestStatus));
router.post( "/:id/resend-brochure", requireAuth, requirePerfxcelTenant,
  asyncHandler(resendBrochure));
router.delete("/", requireAuth, requirePerfxcelTenant,
  asyncHandler(deleteInterests));
```

**`routes/trainingPlan.ts`:**
```typescript
router.get(  "/",          requireAuth, requirePerfxcelTenant, asyncHandler(getTrainingPlanRequests));
router.post( "/request",   strictLimiter, validateBody(trainingPlanSchema), asyncHandler(requestTrainingPlan));
router.post( "/",          requireAuth, requirePerfxcelTenant,
  validateBody(manualTrainingPlanSchema), asyncHandler(createTrainingPlanManual));
router.get(  "/download/:token", asyncHandler(downloadTrainingPlan));
router.post( "/:id/resend",  requireAuth, requirePerfxcelTenant, asyncHandler(resendTrainingPlan));
router.delete("/",           requireAuth, requirePerfxcelTenant, asyncHandler(deleteTrainingPlans));
```

### 2.11 Audit logging in existing controllers

Controllers that need `logAuditEvent` calls added:

| Controller | Function | Event |
|---|---|---|
| `courseController` | `registerInterest` | `FORM_SUBMITTED` |
| `courseController` | `createCourse` | `COURSE_CREATED` |
| `courseController` | `updateCourse` | `COURSE_UPDATED` |
| `trainingPlanController` | `requestTrainingPlan` | `FORM_SUBMITTED` |
| `enquiryController` | `submitContact` | `FORM_SUBMITTED` |
| `interestController` | `updateInterestStatus` | `INTEREST_STATUS_CHANGED` |
| `enrollmentController` | `updateEnrollmentStatus` | `ENROLLMENT_STATUS_CHANGED` |
| `enrollmentController` | `createEnrollment` | `ENROLLMENT_CREATED` |
| `enrollmentController` | `resendCertificate` | `EMAIL_SENT` |

### 2.12 `.env.example` — add missing variables

```dotenv
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
VITE_PERFXCEL_TURNSTILE_SECRET_KEY=
VITE_PERFXCEL_TURNSTILE_HOSTNAMES=perfxcel.com,www.perfxcel.com
PERFXCEL_API_URL=https://api.perfxcel.com
PORT=8000
```

---

## 3. Admin Frontend (`perfxcel-admin`)

### 3.1 `src/lib/api.ts` — interface and function additions

```typescript
// Updated Course interface
export interface CourseDay {
  day:     number;
  title:   string;
  modules: CourseModule[];
}

export interface CourseModule {
  title:        string;
  description?: string;
  duration?:    string;
}

export interface Course {
  // ...existing fields unchanged
  course_outline?: CourseDay[] | null;
  brochure_url?:   string | null;
}

// Settings
export const getSettings = () =>
  api.get("/settings").then(r => r.data.data as Array<{ setting_key: string; setting_value: unknown }>);

export const updateSetting = (setting_key: string, setting_value: unknown) =>
  api.patch("/settings", { setting_key, setting_value }).then(r => r.data);

// Training plan
export const createTrainingPlanManual = (data: {
  name: string; email: string; mobile: string; designation?: string; company?: string;
}) => api.post("/training-plan", data).then(r => r.data.data);

export const resendTrainingPlan = (id: string) =>
  api.post(`/training-plan/${id}/resend`).then(r => r.data);

export const deleteTrainingPlans = (ids: string[]) =>
  api.delete("/training-plan", { data: { ids } }).then(r => r.data);

// Interests
export const createInterestManual = (data: {
  course_id: string; name: string; email: string;
  phone?: string; company?: string; send_brochure?: boolean;
}) => api.post("/interests", data).then(r => r.data.data);

export const resendBrochure = (id: string) =>
  api.post(`/interests/${id}/resend-brochure`).then(r => r.data);

export const deleteInterests = (ids: string[]) =>
  api.delete("/interests", { data: { ids } }).then(r => r.data);
```

### 3.2 New: `src/pages/Settings.tsx`

Two `<input type="number">` fields: Training Plan Link Expiry (days) and Brochure Link Expiry (days). On mount, calls `getSettings()` and pre-fills both. On save, calls `updateSetting` for each changed field. Success/error shown via inline `Alert` from `@dotevolve/ui-kit`. Register route in `App.tsx` and add nav link in the `Layout` sidebar.

### 3.3 `TrainingPlanRequests.tsx` — new state and UI

**New state:**
```typescript
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [showAddModal, setShowAddModal] = useState(false);
const [resendingIds, setResendingIds] = useState<Record<string, boolean>>({});
const [resendResults, setResendResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);
```

**Table:** Checkbox column prepended. Actions column gets per-row **Resend** button (loading state from `resendingIds[id]`) and trash icon.

**Toolbar:** "Add Request" button always visible. "Delete Selected (n)" red button appears when `selectedIds.size > 0`.

**`ManualTrainingPlanModal`:** Inline component (or small separate file). Fields: name*, email*, mobile*, designation, company. On submit calls `createTrainingPlanManual`. On success closes modal and calls `fetchRequests()`.

**Resend pattern** (identical to Enrollments.tsx Resend Certificate):
```typescript
const handleResend = async (id: string) => {
  setResendingIds(prev => ({ ...prev, [id]: true }));
  setResendResults(prev => ({ ...prev, [id]: { ok: false, msg: "" } }));
  try {
    const res = await resendTrainingPlan(id);
    const msg = res.data?.regenerated ? "Sent! (link regenerated)" : "Sent!";
    setResendResults(prev => ({ ...prev, [id]: { ok: true, msg } }));
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } };
    setResendResults(prev => ({ ...prev, [id]: { ok: false, msg: e.response?.data?.message ?? "Failed" } }));
  } finally {
    setResendingIds(prev => ({ ...prev, [id]: false }));
  }
};
```

### 3.4 `Interests.tsx` — selection, delete, brochure indicators, resend, manual add

Same selection and delete infrastructure as Training Plans.

**Row brochure badge:** In the Name cell, if `interest.brochure_token`:
```tsx
<span title="Brochure requested" className="ml-1 text-indigo-400">
  <FileText className="w-3.5 h-3.5 inline" />
</span>
```

**Resend Brochure button:** Visible when `interest.brochure_token` is set. Same per-row loading/success/error pattern.

**`ManualInterestModal`:** Fields: Course (dropdown from existing `courses` state), name*, email*, phone, company, **Send Brochure** checkbox (only visible if selected course has `brochure_url`). On submit calls `createInterestManual`.

### 3.5 `CourseForm.tsx` — Course Outline section (with `react-hook-form`)

See Section 9 for the full `react-hook-form` migration design. The outline section specifically uses:

- `useFieldArray({ control, name: "course_outline" })` for the days list.
- A nested `useFieldArray({ control, name: \`course_outline.${dayIndex}.modules\` })` per day, used inside a `SortableDay` sub-component.
- `@dnd-kit/sortable` `SortableContext` wraps the day list; `moveDay()` from `useFieldArray` is called in `handleDragEnd`.
- Day `day` numbers are renumbered sequentially after every drag via `setValue()`.
- Each module row: `register(\`course_outline.${dayIndex}.modules.${moduleIndex}.title\`)` etc.
- Inline validation errors from `errors.course_outline?.[dayIndex]?.title?.message` etc.

### 3.6 `AuditLogs.tsx` — entity type filter + details column

**New filter** alongside existing action filter:
```tsx
<select
  value={filters.entityType || ""}
  onChange={(e) => setFilters({ entityType: e.target.value || undefined })}
  className="text-sm border border-gray-300 rounded-lg py-2 px-3 focus:ring-2 focus:ring-indigo-500"
>
  <option value="">All Entity Types</option>
  <option value="course">Course</option>
  <option value="course_interest">Interest</option>
  <option value="enrollment">Enrollment</option>
  <option value="training_plan_request">Training Plan</option>
  <option value="enquiry">Enquiry</option>
</select>
```

**Details column** (after Resource ID):
```tsx
<td className="px-6 py-4 text-sm text-gray-500 max-w-xs">
  {log.metadata && Object.keys(log.metadata).length > 0 ? (
    <details>
      <summary className="cursor-pointer text-indigo-600 hover:text-indigo-800 text-xs">
        View details
      </summary>
      <pre className="mt-1 text-xs bg-gray-50 p-2 rounded overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(log.metadata, null, 2)}
      </pre>
    </details>
  ) : (
    <span className="text-gray-300">—</span>
  )}
</td>
```

Update `AuditLogFilters` in `src/types/auditLog.ts`: add `entityType?: string`.
Update `getAuditLogs` in `src/lib/api.ts`: include `entity_type` in `backendFilters`.
Update `useAuditLogs` hook: pass `entityType` through.

---

## 4. Public App (`perfxcel-app`)

### 4.1 `src/types/course.ts` additions

```typescript
export interface CourseDay {
  day:     number;
  title:   string;
  modules: CourseModule[];
}

export interface CourseModule {
  title:        string;
  description?: string;
  duration?:    string;
}

// Extend existing Course interface
export interface Course {
  // ...all existing fields
  course_outline?: CourseDay[] | null;
  brochure_url?:   string | null;
}
```

### 4.2 `src/api.ts` — add `requestCourseBrochure`

```typescript
export const requestCourseBrochure = async (
  courseId: string,
  data: { name: string; email: string; phone?: string; company?: string },
  turnstileToken: string,
) => {
  const response = await api.post(`/courses/${courseId}/interest`, {
    ...data,
    turnstileToken,
    request_brochure: true,
  });
  return response.data;
};
```

Reuses the existing `POST /courses/:id/interest` endpoint — the `request_brochure: true` flag triggers brochure token generation on the backend.

### 4.3 New: `src/components/BrochureModal.tsx`

Mirrors `RegisterInterestModal.tsx` in structure:
- Fields: name*, email*, phone, company.
- Turnstile (same site key, same `onExpire`/`onError` pattern with error state message).
- Submit disabled when `!turnstileToken`.
- On submit: calls `requestCourseBrochure(courseId, formData, turnstileToken)`.
- Success state: "Check your email! A download link has been sent to {email}."
- No inline PDF download — link is emailed only.
- Error handling: `err.response?.data?.message ?? "Failed to submit. Please try again."` (no `AppError instanceof` check — it will never match).

### 4.4 `CourseDetail.tsx` — Download Brochure CTA

In sidebar, below Register Interest button:
```tsx
{course.brochure_url && (
  <button
    onClick={() => setShowBrochureModal(true)}
    className="w-full mt-3 border-2 border-primary-600 text-primary-700 font-bold py-3 rounded-xl hover:bg-primary-50 transition flex items-center justify-center gap-2"
  >
    <FileDown className="w-4 h-4" />
    Download Brochure
  </button>
)}
```

Add `showBrochureModal` state and `BrochureModal` render at the bottom (alongside existing `RegisterInterestModal`).

### 4.5 `CourseDetail.tsx` — Course Outline accordion section

Insert between the objectives/target-audience grid and the schedules table:
```tsx
{course.course_outline && course.course_outline.length > 0 && (
  <div className="mb-12">
    <h3 className="font-bold text-secondary-900 text-2xl mb-6 flex items-center">
      <BookOpen className="w-6 h-6 mr-2 text-primary-500" />
      Course Outline
    </h3>
    <div className="space-y-3">
      {course.course_outline.map((day) => (
        <details
          key={day.day}
          className="bg-white border border-gray-100 rounded-2xl overflow-hidden group"
        >
          <summary className="px-6 py-4 flex items-center justify-between cursor-pointer list-none select-none">
            <span className="font-bold text-secondary-900">
              Day {day.day}: {day.title}
            </span>
            <ChevronDown className="w-5 h-5 text-secondary-400 group-open:rotate-180 transition-transform" />
          </summary>
          {day.modules.length > 0 && (
            <div className="px-6 pb-4 divide-y divide-gray-50">
              {day.modules.map((mod, i) => (
                <div key={i} className="py-3">
                  <div className="flex items-start justify-between">
                    <p className="font-medium text-secondary-800">{mod.title}</p>
                    {mod.duration && (
                      <span className="text-xs text-secondary-400 ml-4 shrink-0 mt-0.5">
                        {mod.duration}
                      </span>
                    )}
                  </div>
                  {mod.description && (
                    <p className="text-sm text-secondary-500 mt-1 leading-relaxed">
                      {mod.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </details>
      ))}
    </div>
  </div>
)}
```

Import `BookOpen`, `ChevronDown`, `FileDown` from `lucide-react` (add to existing import line).

---

## 5. Cross-Cutting Decisions

| Decision | Choice | Reason |
|---|---|---|
| Token generation | `crypto.randomUUID()` | Native in Node 24 — no `uuid` package needed |
| Settings cache | In-process 5-min TTL | Config data changes infrequently; Redis not in this service's stack |
| Brochure PDF storage | Admin uploads via CourseForm; not dynamically generated | Brochures are designed marketing PDFs, not programmatic output |
| Audit failure mode | Fire-and-forget, errors swallowed | Audit must never block a primary operation |
| Hard delete strategy | Anonymisation over row deletion | Preserves referential integrity for enrollment/certificate FK chains |
| `react-hook-form` | Introduced for full `CourseForm.tsx` | Justified by three-level nested dynamic arrays; `useFieldArray` is the idiomatic solution |

---

## 6. DB Migrations Consolidation

### Goal
Produce a single `perfxcel_master.sql` file that can be applied to a blank Supabase database to produce an identical schema to production. Historical migration files are archived, not deleted.

### Approach

#### Step 1 — Inventory existing files
List all files currently in `supabase/migrations/` (or wherever the project keeps them) and read each one to understand the full current schema. The two known files are:
- `20260912000000_create_perfxcel_schema.sql` — initial schema
- `20260921000000_add_updated_at_to_interests_enquiries.sql` — adds `updated_at` columns

#### Step 2 — Draft the master file

The master file is structured in dependency order:

```sql
-- =============================================================
-- perfxcel_master.sql
-- Full schema for the 'perfxcel' Supabase schema.
-- Generated: <date>
-- Apply to a blank database to get a production-equivalent schema.
-- =============================================================

-- 1. Schema creation
CREATE SCHEMA IF NOT EXISTS perfxcel;

-- 2. Extensions (if any, e.g. uuid-ossp — not needed if using gen_random_uuid())

-- 3. Tables (in FK dependency order)
--    courses → course_categories / course_cities / course_associations /
--              course_delivery_modes / course_schedules / course_interests /
--              certificates → enrollments → training_plan_requests / settings

-- 4. Indexes

-- 5. Triggers (e.g. training_plan token generation trigger)

-- 6. RLS policies

-- 7. Grants
```

New columns from this sprint are included inline in the relevant `CREATE TABLE` blocks — not as `ALTER TABLE` statements. The master file is an idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` mix to support re-application safely.

#### Step 3 — Verify on dev

```bash
ssh dev
# spin up a blank supabase-db container
docker exec -it supabase-db-dev psql -U postgres -f /path/to/perfxcel_master.sql
# compare schema with production using pg_dump --schema-only
```

#### Step 4 — Apply to prod

```bash
ssh prod
docker exec -it supabase-db-prod psql -U postgres -f /path/to/perfxcel_master.sql
```

#### Step 5 — Archive historical files

```
supabase/migrations/
  perfxcel_master.sql          ← new primary reference
  archive/
    20260912000000_create_perfxcel_schema.sql
    20260921000000_add_updated_at_to_interests_enquiries.sql
```

### New columns to include from this sprint

The master file must include all columns added in this sprint. They should appear in the base `CREATE TABLE` definitions, not as separate `ALTER` statements:

| Table | New columns |
|---|---|
| `perfxcel.courses` | `course_outline JSONB DEFAULT NULL`, `brochure_url TEXT DEFAULT NULL` |
| `perfxcel.course_interests` | `brochure_token UUID DEFAULT NULL`, `brochure_expires_at TIMESTAMPTZ DEFAULT NULL`, `is_deleted BOOLEAN NOT NULL DEFAULT FALSE`, `deleted_at TIMESTAMPTZ DEFAULT NULL`, `is_hard_deleted BOOLEAN NOT NULL DEFAULT FALSE`, `hard_deleted_at TIMESTAMPTZ DEFAULT NULL` |
| `perfxcel.training_plan_requests` | `is_deleted BOOLEAN NOT NULL DEFAULT FALSE`, `deleted_at TIMESTAMPTZ DEFAULT NULL`, `is_hard_deleted BOOLEAN NOT NULL DEFAULT FALSE`, `hard_deleted_at TIMESTAMPTZ DEFAULT NULL` |
| `perfxcel.settings` | _(new table — see section 1.4)_ |

### Delivery artifact
`perfxcel-api/supabase/migrations/perfxcel_master.sql` committed to the repo. A `README.md` added to `supabase/migrations/` explaining: (1) how to apply from scratch, (2) the archive policy, (3) how to author future changes (add `ALTER TABLE` statements to the master file AND a timestamped file in the main directory for incremental deploys).

---

## 7. dot-docs Documentation Update

### Repository structure reminder
The `dot-docs` repo has two tiers: `public/` (deployed to `docs.dotevolve.net`) and `private/` (internal, never deployed). Both have their own `mkdocs.yml`. All new `.md` files must be registered in the appropriate `nav` section of the relevant `mkdocs.yml`.

### Files to create

#### `public/docs/perfxcel/features/course-brochure.md`
Covers: what the feature is, the user journey (fill form → receive email → click link → download PDF), token expiry behaviour, the Turnstile protection, and what happens when a link expires. No internal architecture details.

#### `public/docs/perfxcel/features/link-expiry-settings.md`
Covers: the `perfxcel.settings` table (key names and valid value ranges), the admin Settings UI, and the effect of changing values (next request only, not retroactive).

#### `public/docs/perfxcel/features/course-outline.md`
Covers: what the outline is, the JSONB structure (show the schema with a worked example), how admins build it in the Course Editor (day-by-day, drag to reorder), and how it renders on the public course page (accordion per day).

#### `private/docs/perfxcel/architecture/audit-logging.md`
Covers: the `logAuditEvent()` utility, all 8+ event constants with their `entity_type` and `details` shape, actor resolution for public vs protected routes, the fire-and-forget failure mode, and how to add a new event type.

#### `private/docs/perfxcel/architecture/gdpr-erasure.md`
Covers: the anonymisation-over-deletion strategy, the `is_hard_deleted` flag, which fields are erased, the `GDPR_ERASURE` audit event, the admin UI flow, and the FK integrity rationale.

#### Updates to existing files
- `private/docs/perfxcel/database/schema.md` — add new columns and the `settings` table to the schema reference.
- `public/docs/perfxcel/api/endpoints.md` (or create if missing) — document all new routes from this sprint.

### `mkdocs.yml` nav additions

**`public/mkdocs.yml`** — under `perfxcel` section:
```yaml
- Features:
  - Course Brochure: perfxcel/features/course-brochure.md
  - Configurable Link Expiry: perfxcel/features/link-expiry-settings.md
  - Course Outline: perfxcel/features/course-outline.md
```

**`private/mkdocs.yml`** — under `perfxcel/Architecture`:
```yaml
- Architecture:
  - Audit Logging: perfxcel/architecture/audit-logging.md
  - GDPR Erasure: perfxcel/architecture/gdpr-erasure.md
```

### Verification
```bash
cd /path/to/dot-docs/public  && mkdocs build   # must exit 0
cd /path/to/dot-docs/private && mkdocs build   # must exit 0
```

---

## 8. Hard Delete (GDPR / Right to Erasure)

### DB changes

```sql
ALTER TABLE perfxcel.course_interests
  ADD COLUMN is_hard_deleted  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN hard_deleted_at  TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE perfxcel.training_plan_requests
  ADD COLUMN is_hard_deleted  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN hard_deleted_at  TIMESTAMPTZ DEFAULT NULL;
```

These columns are included in the consolidated master migration (section 6).

### Backend — new controller functions

**`hardDeleteInterest(req, res)`** — `POST /api/v1/interests/:id/hard-delete` (protected):

```typescript
export const hardDeleteInterest = async (req: Request, res: Response) => {
  const { id } = req.params;

  // Verify record exists and is not already hard-deleted
  const { data: interest, error: fetchError } = await supabase
    .from("course_interests")
    .select("id, name, email, is_hard_deleted")
    .eq("id", id)
    .single();

  if (fetchError || !interest) throw new NotFoundError("Interest not found");
  if (interest.is_hard_deleted) {
    throw new AppError("Record has already been erased", 409, ErrorCategory.VALIDATION);
  }

  // Anonymise PII fields
  const { error } = await supabase
    .from("course_interests")
    .update({
      name:             "[deleted]",
      email:            "[deleted]",
      phone:            null,
      company:          null,
      is_deleted:       true,
      is_hard_deleted:  true,
      deleted_at:       new Date().toISOString(),
      hard_deleted_at:  new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new AppError(error.message, 500, ErrorCategory.SYSTEM);

  void logAuditEvent({
    tenantId:    req.tenantId!,
    actorId:     req.user!.id,
    actorEmail:  req.user!.email,
    action:      "GDPR_ERASURE",
    entityType:  "course_interest",
    entityId:    id,
    details:     { fields_erased: ["name", "email", "phone", "company"] },
  });

  res.status(200).json({ status: "success", message: "Personal data erased" });
};
```

**`hardDeleteTrainingPlan(req, res)`** — `POST /api/v1/training-plan/:id/hard-delete` (protected):

Same pattern. Additional fields to anonymise: `mobile`, `designation`, `company`.

```typescript
.update({
  name:            "[deleted]",
  email:           "[deleted]",
  mobile:          "[deleted]",
  designation:     null,
  company:         null,
  is_deleted:      true,
  is_hard_deleted: true,
  deleted_at:      new Date().toISOString(),
  hard_deleted_at: new Date().toISOString(),
})
```

### Updated route registrations

**`routes/interests.ts`** — add below existing routes:
```typescript
router.post(
  "/:id/hard-delete",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(hardDeleteInterest),
);
```

**`routes/trainingPlan.ts`** — add below existing routes:
```typescript
router.post(
  "/:id/hard-delete",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(hardDeleteTrainingPlan),
);
```

### Updated list queries

Both `getInterests` and `getTrainingPlanRequests` must exclude hard-deleted rows unconditionally — even when `include_deleted=true` is passed:

```typescript
// Always filter out hard-deleted records
query = query.eq("is_hard_deleted", false);

// Soft-delete filter is separate and optional
if (req.query.include_deleted !== "true") {
  query = query.eq("is_deleted", false);
}
```

### Admin frontend — `src/lib/api.ts` additions

```typescript
export const hardDeleteInterest = (id: string) =>
  api.post(`/interests/${id}/hard-delete`).then(r => r.data);

export const hardDeleteTrainingPlan = (id: string) =>
  api.post(`/training-plan/${id}/hard-delete`).then(r => r.data);
```

### Admin frontend — UI changes

Both `Interests.tsx` and `TrainingPlanRequests.tsx` gain a per-row **Erase PII** action in the row actions area. Pattern:

```tsx
// Row action — shown only when row is NOT already hard-deleted
{!row.is_hard_deleted && (
  <button
    onClick={() => setConfirmErase(row)}
    className="text-red-400 hover:text-red-600 ml-2"
    title="Permanently erase personal data"
  >
    <ShieldX className="w-4 h-4 inline" />
  </button>
)}

// Hard-deleted indicator — shown when row IS hard-deleted (visible via include_deleted)
{row.is_hard_deleted && (
  <span className="inline-flex items-center gap-1 text-xs text-gray-400">
    <ShieldOff className="w-3.5 h-3.5" /> Erased
  </span>
)}
```

Confirmation modal — uses existing `ConfirmationModal` with `isDestructive={true}`:
```tsx
<ConfirmationModal
  isOpen={!!confirmErase}
  title="Permanently Erase Personal Data"
  message={
    <>
      This will permanently erase all personal data (name, email, phone, company)
      for <strong>{confirmErase?.name}</strong>.
      The record structure is retained for referential integrity.
      <br /><br />
      A <code>GDPR_ERASURE</code> audit event will be recorded.
    </>
  }
  confirmText="Erase PII"
  onConfirm={() => handleHardDelete(confirmErase!.id)}
  onCancel={() => setConfirmErase(null)}
  isDestructive={true}
/>
```

Import `ShieldX`, `ShieldOff` from `lucide-react`.

---

## 9. `react-hook-form` for `CourseForm.tsx`

### Dependencies to install

```bash
# in perfxcel-admin/
npm install react-hook-form @hookform/resolvers
```

Both are small, well-maintained, zero-runtime-dependency packages.

### Migration strategy — full form conversion

The current `CourseForm.tsx` uses ~15 separate `useState` declarations for individual fields. The migration replaces all of them with a single `useForm` call. This is the correct approach — partial adoption (hook form for outline only, `useState` for everything else) creates two sources of truth and makes the submit handler fragmented.

### Form shape

```typescript
// types — add to src/lib/api.ts (already defined as CourseDay/CourseModule)

interface CourseFormValues {
  short_code:      string;
  title:           string;
  slug:            string;
  description:     string;
  objectives:      string;
  target_audience: string;
  cost:            number | null;
  duration:        string;
  is_published:    boolean;
  is_public:       boolean;
  is_blended:      boolean;
  status:          "active" | "archived";
  category_ids:    string[];
  city_ids:        string[];
  association_ids: string[];
  delivery_mode_ids: string[];
  schedules:       CourseSchedule[];
  course_outline:  CourseDay[];
  brochure_url:    string | null;
}
```

### Resolver

```typescript
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { courseFormSchema } from "../validators/courseFormSchema"; // new file in admin

const { register, handleSubmit, control, watch, setValue, reset, formState: { errors } } =
  useForm<CourseFormValues>({
    resolver: zodResolver(courseFormSchema),
    defaultValues: {
      short_code: "", title: "", slug: "", description: "",
      objectives: "", target_audience: "",
      cost: null, duration: "", is_published: false,
      is_public: false, is_blended: false, status: "active",
      category_ids: [], city_ids: [], association_ids: [],
      delivery_mode_ids: [], schedules: [], course_outline: [],
      brochure_url: null,
    },
  });
```

### Outline field arrays

```typescript
// Top-level days array
const { fields: days, append: appendDay, remove: removeDay, move: moveDay } =
  useFieldArray({ control, name: "course_outline" });

// Per-day modules — scoped by index
// Used inside a SortableDay component that receives `dayIndex` as prop:
const { fields: modules, append: appendModule, remove: removeModule } =
  useFieldArray({ control, name: `course_outline.${dayIndex}.modules` });
```

### Drag-and-drop integration

`@dnd-kit/sortable` drives the visual drag; `react-hook-form`'s `move()` updates the data:

```typescript
const handleDragEnd = (event: DragEndEvent) => {
  const { active, over } = event;
  if (!over || active.id === over.id) return;
  const oldIndex = days.findIndex(d => d.id === active.id);
  const newIndex = days.findIndex(d => d.id === over.id);
  moveDay(oldIndex, newIndex);
  // renumber day.day values sequentially
  days.forEach((_, i) => setValue(`course_outline.${i}.day`, i + 1));
};
```

### `courseFormSchema` (new file: `perfxcel-admin/src/validators/courseFormSchema.ts`)

This is a frontend-only Zod schema (not the backend's `courseOutlineSchema` — that lives in the API). It mirrors the API schema but uses `z.coerce.number()` for numeric fields to handle HTML input string coercion:

```typescript
import { z } from "zod";

const moduleSchema = z.object({
  title:       z.string().trim().min(1, "Module title is required"),
  description: z.string().trim().optional(),
  duration:    z.string().trim().optional(),
});

const daySchema = z.object({
  day:     z.number().int().positive(),
  title:   z.string().trim().min(1, "Day title is required"),
  modules: z.array(moduleSchema).default([]),
});

export const courseFormSchema = z.object({
  title:           z.string().trim().min(1, "Title is required"),
  slug:            z.string().trim().optional(),
  short_code:      z.string().trim().optional(),
  description:     z.string().trim().optional(),
  objectives:      z.string().trim().optional(),
  target_audience: z.string().trim().optional(),
  cost:            z.coerce.number().positive().nullable().optional(),
  duration:        z.string().trim().optional(),
  is_published:    z.boolean().default(false),
  is_public:       z.boolean().default(false),
  is_blended:      z.boolean().default(false),
  status:          z.enum(["active", "archived"]).default("active"),
  category_ids:    z.array(z.string()).default([]),
  city_ids:        z.array(z.string()).default([]),
  association_ids: z.array(z.string()).default([]),
  delivery_mode_ids: z.array(z.string()).default([]),
  schedules:       z.array(z.any()).default([]),
  course_outline:  z.array(daySchema).default([]),
  brochure_url:    z.string().nullable().optional(),
});
```

### `handleSubmit` changes

The current `handleSubmit` reads from ~15 state variables and builds the payload manually. After migration it reads directly from the form values:

```typescript
const onSubmit = async (values: CourseFormValues) => {
  const payload: CourseFormPayload = {
    ...values,
    cost:           values.cost ?? null,
    course_outline: values.course_outline.length > 0 ? values.course_outline : null,
  };
  // image upload logic unchanged (still uses separate imageFile state)
  // brochure upload logic unchanged (separate brochureFile state)
  if (isEdit) await updateCourse(id!, payload);
  else await createCourse(payload);
  navigate("/courses");
};
```

Image upload and brochure upload are still handled by separate `useState` (`imageFile`, `brochureFile`) because they involve `File` objects that `react-hook-form` doesn't manage natively. The `brochure_url` field in the form stores the *resulting URL* after upload, not the `File` itself.

### Edit mode — loading existing data

Replace the current `api.get('/courses/:id').then(...)` with a `reset()` call:

```typescript
useEffect(() => {
  if (isEdit) {
    api.get(`/courses/${id}`).then(res => {
      const c = res.data.data;
      reset({
        title:            c.title,
        slug:             c.slug ?? "",
        short_code:       c.short_code ?? "",
        description:      c.description ?? "",
        objectives:       c.objectives ?? "",
        target_audience:  c.target_audience ?? "",
        cost:             c.cost,
        duration:         c.duration ?? "",
        is_published:     c.is_published,
        is_public:        c.is_public ?? false,
        is_blended:       c.is_blended ?? false,
        status:           c.status ?? "active",
        category_ids:     c.categories?.map((x: any) => x.id) ?? [],
        city_ids:         c.cities?.map((x: any) => x.id) ?? [],
        association_ids:  c.associations?.map((x: any) => x.id) ?? [],
        delivery_mode_ids: c.delivery_modes?.map((x: any) => x.id) ?? [],
        schedules:        c.course_schedules ?? [],
        course_outline:   c.course_outline ?? [],
        brochure_url:     c.brochure_url ?? null,
      });
    });
  }
}, [id, isEdit]);
```

### Cross-cutting decision update

| Decision | Previous | Updated |
|---|---|---|
| `react-hook-form` | Not introduced (plain useState) | Introduced — replaces all 15+ `useState` form fields in `CourseForm.tsx`; `useFieldArray` for nested outline |
