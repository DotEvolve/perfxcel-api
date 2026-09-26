# Technical Design

## Perfxcel Phase 2 — File Uploads, Audit Logs, Filters & Course Overview

All designs grounded in actual source code.

---

## 1. File Upload Fix

### 1.1 Backend — new `src/routes/upload.ts` + `src/controllers/uploadController.ts`

Install multer (check if already present first):

```bash
npm install multer @types/multer  # in perfxcel-api
```

**`src/routes/upload.ts`:**

```typescript
import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { requirePerfxcelTenant } from "../middleware/tenant";
import {
  uploadTrainingPlan,
  downloadTrainingPlan,
  uploadCourseBrochure,
} from "../controllers/uploadController";

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      cb(new Error("Only PDF files are allowed"));
    } else {
      cb(null, true);
    }
  },
});

const router = Router();
router.post(
  "/training-plan",
  requireAuth,
  requirePerfxcelTenant,
  pdfUpload.single("file"),
  asyncHandler(uploadTrainingPlan),
);
router.get(
  "/training-plan/download",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(downloadTrainingPlan),
);
router.post(
  "/course-brochure",
  requireAuth,
  requirePerfxcelTenant,
  pdfUpload.single("file"),
  asyncHandler(uploadCourseBrochure),
);

export default router;
```

Register in `app.ts`:

```typescript
import uploadRoutes from "./routes/upload";
app.use("/api/v1/upload", uploadRoutes);
```

**`src/controllers/uploadController.ts`:**

```typescript
import { Request, Response } from "express";
import { perfxcelSupabase } from "../db/supabase";
import { AppError, ErrorCategory, NotFoundError } from "@dotevolve/error-utils";

export const uploadTrainingPlan = async (req: Request, res: Response) => {
  if (!req.file)
    throw new AppError("No file provided", 400, ErrorCategory.VALIDATION);

  const { error } = await perfxcelSupabase.storage
    .from("assets")
    .upload("training_plan.pdf", req.file.buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) throw new AppError(error.message, 500, ErrorCategory.SYSTEM);

  // Return the API download URL (not a direct storage URL — keeps the proxy pattern)
  const url = `${process.env.PERFXCEL_API_URL}/api/v1/upload/training-plan/download`;
  res.status(200).json({ status: "success", data: { url } });
};

export const downloadTrainingPlan = async (_req: Request, res: Response) => {
  const { data, error } = await perfxcelSupabase.storage
    .from("assets")
    .createSignedUrl("training_plan.pdf", 60);

  if (error || !data?.signedUrl)
    throw new NotFoundError("Training plan not found");

  res
    .status(200)
    .json({ status: "success", data: { signedUrl: data.signedUrl } });
};

export const uploadCourseBrochure = async (req: Request, res: Response) => {
  if (!req.file)
    throw new AppError("No file provided", 400, ErrorCategory.VALIDATION);

  const { short_code } = req.body;
  if (!short_code)
    throw new AppError("short_code is required", 400, ErrorCategory.VALIDATION);

  const filename = `${short_code}.pdf`;
  const { error } = await perfxcelSupabase.storage
    .from("course-brochures")
    .upload(filename, req.file.buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) throw new AppError(error.message, 500, ErrorCategory.SYSTEM);

  const { data: urlData } = perfxcelSupabase.storage
    .from("course-brochures")
    .getPublicUrl(filename);

  // course-brochures bucket is private — return API proxy URL for download
  const url = `${process.env.PERFXCEL_API_URL}/api/v1/interests/brochure/by-course/${short_code}`;

  res
    .status(200)
    .json({ status: "success", data: { url: urlData.publicUrl, filename } });
};
```

Note: `perfxcelSupabase` is the service-role client — it bypasses RLS entirely. No policy change needed on the `assets` bucket.

### 1.2 Admin frontend changes

**`src/lib/api.ts` additions:**

```typescript
export const uploadTrainingPlan = async (
  file: File,
): Promise<{ url: string }> => {
  const form = new FormData();
  form.append("file", file);
  const response = await api.post("/upload/training-plan", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data.data;
};

export const downloadTrainingPlanUrl = async (): Promise<string> => {
  const response = await api.get("/upload/training-plan/download");
  return response.data.data.signedUrl;
};

export const uploadCourseBrochure = async (
  file: File,
  shortCode: string,
): Promise<{ url: string }> => {
  const form = new FormData();
  form.append("file", file);
  form.append("short_code", shortCode);
  const response = await api.post("/upload/course-brochure", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data.data;
};
```

**`Settings.tsx` — replace both storage calls:**

```typescript
// BEFORE
const { error } = await supabase.storage.from("assets").upload(...)
// AFTER
await uploadTrainingPlan(file);  // from api.ts

// BEFORE
const { data } = await supabase.storage.from("assets").createSignedUrl(...)
window.open(data.signedUrl)
// AFTER
const signedUrl = await downloadTrainingPlanUrl();
window.open(signedUrl, "_blank");
```

Remove `import { supabase } from "../lib/supabase"` from `Settings.tsx` once these are the only two uses.

**`CourseForm.tsx` — brochure upload:**

```typescript
// In handleSubmit, replace:
const { error } = await supabase.storage.from("course-images").upload(filename, brochureFile, ...)
// With:
const result = await uploadCourseBrochure(brochureFile, values.short_code);
setValue("brochure_url", result.url);
```

The dynamic `import("../lib/supabase")` inside `handleSubmit` is left as-is for image uploads (they already work). Brochure no longer needs it.

---

## 2. Audit Log Fix

### 2.1 Fix Bug A — URL path in `auditLogger.ts`

```typescript
// BEFORE:
await fetch(`${portalUrl}/api/v1/audit/logs/ingest`, { ... });

// AFTER:
await fetch(`${portalUrl}/api/v1/audit-logs`, { ... });
```

### 2.2 Fix Bug B — missing `actorType` field

**Update `AuditEventParams` interface:**

```typescript
interface AuditEventParams {
  tenantId?: string;
  actorId: string;
  actorEmail?: string;
  actorType: "user" | "service"; // ← ADD THIS — required by portal Zod schema
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
}
```

**Update the body sent to the portal to match `ingestAuditLogsSchema`:**

```typescript
body: JSON.stringify({
  events: [{
    tenantId:    tenantId,
    action:      params.action,
    actorId:     params.actorId,
    actorType:   params.actorType,         // ← ADD
    entityType:  params.entityType,
    entityId:    params.entityId,
    details:     params.details ?? {},
    timestamp:   new Date().toISOString(),
  }],
}),
```

**Update all `logAuditEvent` call sites in controllers:**

| Controller               | Function                   | `actorType` value                   |
| ------------------------ | -------------------------- | ----------------------------------- |
| `courseController`       | `registerInterest`         | `"service"` (public route, no user) |
| `courseController`       | `createCourse`             | `"user"`                            |
| `courseController`       | `updateCourse`             | `"user"`                            |
| `trainingPlanController` | `requestTrainingPlan`      | `"service"`                         |
| `enquiryController`      | `submitContact`            | `"service"`                         |
| `interestController`     | `updateInterestStatus`     | `"user"`                            |
| `interestController`     | `createInterestManual`     | `"user"`                            |
| `interestController`     | `resendBrochure`           | `"user"`                            |
| `interestController`     | `deleteInterests`          | `"user"`                            |
| `interestController`     | `hardDeleteInterest`       | `"user"`                            |
| `enrollmentController`   | `updateEnrollmentStatus`   | `"user"`                            |
| `enrollmentController`   | `createEnrollment`         | `"user"`                            |
| `enrollmentController`   | `resendCertificate`        | `"user"`                            |
| `trainingPlanController` | `createTrainingPlanManual` | `"user"`                            |
| `trainingPlanController` | `resendTrainingPlan`       | `"user"`                            |
| `trainingPlanController` | `deleteTrainingPlans`      | `"user"`                            |
| `trainingPlanController` | `hardDeleteTrainingPlan`   | `"user"`                            |
| `settingsController`     | `updateSettings`           | `"user"`                            |

### 2.3 Fix Bug C — proxy error surfacing

In `routes/auditLogs.ts`, both POST and GET handlers: when the portal returns non-OK, log the actual response before re-throwing:

```typescript
if (!response.ok) {
  const data = await response.json().catch(() => ({}));
  // Surface the real error — currently swallowed
  console.error("[auditLogs proxy] Portal returned", response.status, data);
  return res.status(response.status).json(data);
}
```

This alone will make the actual 4xx reason visible in server logs and Sentry, allowing the proxy auth issue to be diagnosed and fixed separately.

---

## 3. Course Overview Field

### 3.1 Database

Add to `dot-portal-api/supabase/migrations/20260912000000_perfxcel_master.sql` — in the `courses` table definition and as an `ALTER TABLE`:

```sql
-- In CREATE TABLE block:
overview TEXT DEFAULT NULL,

-- Idempotent ALTER for existing DB:
ALTER TABLE perfxcel.courses
  ADD COLUMN IF NOT EXISTS overview TEXT DEFAULT NULL;
```

### 3.2 Backend — `src/validators/schemas.ts`

```typescript
export const courseInputSchema = z
  .object({
    // ...existing fields...
    overview: z.string().trim().max(5000).optional().nullable(),
    course_outline: courseOutlineSchema.optional().nullable(),
    brochure_url: z.string().url().optional().nullable(),
  })
  .passthrough();
```

No changes to `courseController.ts` needed — `overview` passes through `coreFields` in `createCourse` / `updateCourse` destructuring already (because `category_ids`, `city_ids`, etc. are extracted but everything else including unknown fields goes into `coreFields` via the spread).

### 3.3 Admin frontend — `CourseForm.tsx`

**`courseFormSchema.ts` addition:**

```typescript
overview: z.string().trim().max(5000).optional().nullable(),
```

**`CourseFormValues` default values:**

```typescript
overview: null,
```

**Load on edit** (inside `reset({...})`):

```typescript
overview: course.overview ?? null,
```

**JSX** — add after the Description `<textarea>`, before Objectives in the Basic Info section:

```tsx
<div>
  <label className="block text-sm font-medium text-gray-700 mb-1">
    Course Overview
  </label>
  <textarea
    {...register("overview")}
    rows={5}
    className="w-full border border-gray-300 rounded-md p-2"
    placeholder="A narrative overview of the course for the public course page..."
  />
  <p className="mt-1 text-xs text-gray-500">
    {(watch("overview") ?? "").length}/5000 characters. Displayed at the top of
    the public course page.
  </p>
  {errors.overview && (
    <p className="mt-1 text-sm text-red-600">{errors.overview.message}</p>
  )}
</div>
```

**`Course` interface in `api.ts`:**

```typescript
overview?: string | null;
```

### 3.4 Public app — `CourseDetail.tsx`

Insert between the hero image block and the badges/title section (or after the title and before the description — whichever gives the best visual flow based on existing layout):

```tsx
{
  course.overview && (
    <div className="mb-12">
      <h2 className="font-bold text-secondary-900 text-2xl mb-4">Overview</h2>
      <p className="text-secondary-700 leading-relaxed whitespace-pre-wrap text-lg">
        {course.overview}
      </p>
    </div>
  );
}
```

Looking at the current layout order in `CourseDetail.tsx`:

1. Hero image
2. Breadcrumb
3. Badges (categories, cities, associations)
4. Title `<h1>`
5. Description prose block
6. Objectives / Target Audience grid
7. Schedules table

Place the Overview section **between step 5 (description) and step 6 (objectives)** so the narrative flows from brief description → full overview → structured objectives.

**`Course` interface in `src/types/course.ts`:**

```typescript
overview?: string | null;
```

---

## 4. Shared FilterBar Component

### 4.1 `src/components/FilterBar.tsx`

```typescript
import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";

interface StatusOption { label: string; value: string; }

interface FilterBarProps {
  search:           string;
  onSearchChange:   (v: string) => void;
  statusOptions?:   StatusOption[];
  status?:          string;
  onStatusChange?:  (v: string) => void;
  dateFrom?:        string;
  onDateFromChange?: (v: string) => void;
  dateTo?:          string;
  onDateToChange?:  (v: string) => void;
  onClear:          () => void;
  children?:        React.ReactNode;  // page-specific extras (e.g. course dropdown)
}

export default function FilterBar({
  search, onSearchChange, statusOptions, status, onStatusChange,
  dateFrom, onDateFromChange, dateTo, onDateToChange, onClear, children,
}: FilterBarProps) {
  // Debounced search — fires onSearchChange 300ms after typing stops
  const [localSearch, setLocalSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => onSearchChange(localSearch), 300);
    return () => clearTimeout(t);
  }, [localSearch]);
  // Sync external clear
  useEffect(() => { setLocalSearch(search); }, [search]);

  const hasActiveFilters =
    !!search || (!!status && status !== "all") || !!dateFrom || !!dateTo;

  return (
    <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-wrap gap-3 items-center">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Search..."
          className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      {/* Status dropdown */}
      {statusOptions && onStatusChange && (
        <select
          value={status ?? "all"}
          onChange={(e) => onStatusChange(e.target.value)}
          className="border border-gray-300 rounded-md text-sm py-2 px-3 bg-white focus:ring-indigo-500 focus:border-indigo-500"
        >
          <option value="all">All Statuses</option>
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}

      {/* Date range */}
      {onDateFromChange && (
        <input type="date" value={dateFrom ?? ""} onChange={(e) => onDateFromChange(e.target.value)}
          className="border border-gray-300 rounded-md text-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500"
        />
      )}
      {onDateToChange && (
        <input type="date" value={dateTo ?? ""} onChange={(e) => onDateToChange(e.target.value)}
          className="border border-gray-300 rounded-md text-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500"
        />
      )}

      {/* Page-specific extras */}
      {children}

      {/* Active filters badge + clear */}
      {hasActiveFilters && (
        <button onClick={onClear}
          className="inline-flex items-center gap-1 px-3 py-2 bg-indigo-50 text-indigo-700 rounded-md text-sm font-medium hover:bg-indigo-100"
        >
          <X className="w-3.5 h-3.5" /> Clear filters
        </button>
      )}
    </div>
  );
}
```

### 4.2 Per-page changes

**Enquiries.tsx:**

```typescript
const [status, setStatus] = useState("all");
const [dateFrom, setDateFrom] = useState("");
const [dateTo, setDateTo] = useState("");

// Pass to API:
getEnquiries({ search, page, limit: 10, status: status !== "all" ? status : undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined })

// Replace form+input with:
<FilterBar
  search={search} onSearchChange={(v) => { setSearch(v); setPage(1); }}
  statusOptions={[{ label: "New", value: "new" }, { label: "Responded", value: "responded" }]}
  status={status} onStatusChange={(v) => { setStatus(v); setPage(1); }}
  dateFrom={dateFrom} onDateFromChange={(v) => { setDateFrom(v); setPage(1); }}
  dateTo={dateTo} onDateToChange={(v) => { setDateTo(v); setPage(1); }}
  onClear={() => { setSearch(""); setStatus("all"); setDateFrom(""); setDateTo(""); setPage(1); }}
/>
```

**Interests.tsx:** Same pattern. Pass course dropdown as `children` of `FilterBar`. Remove existing filter row.

**Enrollments.tsx:** Replace filter row. Date range optional (server doesn't support it — apply client-side on `created_at` if needed, or add backend support).

**TrainingPlanRequests.tsx:** Replace form+input. Expiry status is client-side: after fetch, if `expiryStatus === "expired"`, filter results by `new Date(r.expires_at) < new Date()`.

### 4.3 Backend date filter additions

In `perfxcel-api` controllers for `getEnquiries`, `getInterests`, `getTrainingPlanRequests`:

```typescript
const { date_from, date_to } = req.query;
if (date_from) query = query.gte("created_at", date_from);
if (date_to) query = query.lte("created_at", date_to);
```

---

## 5. Unified Register Interest & Download Brochure Flow

### 5.1 Backend — remove duplicate `POST /courses/:id/brochure` endpoint

The unified flow already exists: `POST /courses/:id/interest` with `request_brochure: true` in the body. The separate brochure endpoint is redundant.

In `src/routes/courses.ts`, remove:

```typescript
router.post(
  "/:id/brochure",
  strictLimiter,
  validateBody(brochureRequestSchema),
  asyncHandler(requestBrochureHandler),
);
```

And delete the corresponding handler from `courseController.ts` (or wherever `requestBrochure` is defined).

Verify `registerInterest` in `courseController.ts` handles `request_brochure: true` correctly — it already does per the sprint-1 implementation:

```typescript
const { name, email, phone, company, turnstileToken, request_brochure } =
  req.body;
// ... Turnstile validation ...
// After insert:
if (request_brochure && courseQuery.data.brochure_url) {
  // generate token, send brochure email
}
```

No backend changes beyond removing the duplicate route.

### 5.2 Frontend — `perfxcel-app/src/api.ts`

**Remove** `requestBrochure` function entirely.

**Update** `submitCourseInterest` to accept `request_brochure`:

```typescript
export const submitCourseInterest = async (
  courseId: string,
  data: {
    name: string;
    email: string;
    phone?: string;
    company?: string;
    request_brochure?: boolean; // ← add
  },
  turnstileToken: string,
) => {
  const response = await api.post(`/courses/${courseId}/interest`, {
    ...data,
    turnstileToken,
  });
  return response.data;
};
```

### 5.3 Frontend — `RegisterInterestModal.tsx`

**Add prop:**

```typescript
interface RegisterInterestModalProps {
  course: Course;
  onClose: () => void;
  sendBrochure?: boolean; // ← add
}
```

**Submit handler** — pass flag through:

```typescript
await submitCourseInterest(
  course.id,
  { ...formData, request_brochure: sendBrochure ?? false },
  turnstileToken,
);
```

**Success message** — conditional:

```tsx
<div className="bg-green-50 text-green-700 p-4 rounded-xl text-center font-medium">
  {sendBrochure
    ? "Thank you! We've received your details and sent the course brochure to your email."
    : "Thank you! We've received your details."}
</div>
```

No other changes to the modal — the form fields, Turnstile, and styling are unchanged.

### 5.4 Frontend — `CourseDetail.tsx`

**Remove:**

- `const [showBrochureModal, setShowBrochureModal] = useState(false);`
- The `BrochureModal` import
- The separate "Download Brochure" button JSX
- The `{showBrochureModal && <BrochureModal ... />}` render at the bottom

**Update "Register Interest" button:**

```tsx
<button
  onClick={() => setShowModal(true)}
  className="w-full bg-accent-500 hover:bg-accent-600 text-secondary-900 font-bold py-4 rounded-xl shadow-lg shadow-accent-500/30 transform transition hover:-translate-y-0.5"
>
  {course.brochure_url
    ? "Register Interest & Download Brochure"
    : "Register Interest"}
</button>
```

**Update `RegisterInterestModal` render:**

```tsx
{
  showModal && (
    <RegisterInterestModal
      course={course}
      onClose={() => setShowModal(false)}
      sendBrochure={!!course.brochure_url}
    />
  );
}
```

The `Download` lucide icon import can be removed from this file if it's no longer used after the button is gone.

### 5.5 Delete `BrochureModal.tsx`

Delete `src/components/BrochureModal.tsx` from `perfxcel-app`. The component is no longer referenced anywhere once `CourseDetail.tsx` is updated.
