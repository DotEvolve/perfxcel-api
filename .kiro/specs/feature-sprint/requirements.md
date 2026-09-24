# Requirements
## Perfxcel Feature Sprint — Brochures, Course Outline, Configurable Expiry, Bulk Delete, Audit, Migrations, Hard Delete & Docs

**Scope:** `perfxcel-api` · `perfxcel-admin` · `perfxcel-app` · `dot-docs` · Supabase migrations

---

## 1. Course Brochure Download & Registration Flow

### What
Every course page gains a second CTA alongside "Register Interest": **"Download Brochure"**. When a visitor fills in the form, their contact details are saved as a course interest record and a time-limited download link is emailed to them — identical in mechanics to the Training Plan flow.

### Why
The existing sidebar on `CourseDetail.tsx` only has "Register Interest". Marketing needs a softer lead-generation hook for visitors not yet ready to commit. Brochures gate a useful artefact behind a form, producing qualified contacts.

### User stories
- As a visitor, I can fill in my name, email, phone, and company on a course page and click **Download Brochure** so that I receive a link to the course PDF in my inbox.
- As an admin, I can see which contacts requested a brochure for which course, with their link expiry status.
- As an admin, I can resend the brochure email if a contact's link has expired.
- As an admin, I can manually add a brochure request entry for a contact who asked offline.

### Acceptance criteria
- AC1: The public-facing course detail page shows a **Download Brochure** button when `brochure_url` is set on the course.
- AC2: The form collects `name` (required), `email` (required), `phone`, `company`. Turnstile is required before submission.
- AC3: On successful submission, an email is sent containing a tokenised download link.
- AC4: The download link resolves to the course's brochure PDF stored in Supabase Storage (`course-brochures` bucket).
- AC5: The link expires after the configured `brochure_expiry_days` setting (default 180 days).
- AC6: Accessing an expired link returns HTTP 403 with a clear error message.
- AC7: The brochure flow reuses the `course_interests` table with added `brochure_token` and `brochure_expires_at` columns. No new table is created.
- AC8: Admin Interests page shows a brochure indicator badge on rows where `brochure_token` is set.
- AC9: Admin can resend the brochure link. If expired, a new token is generated and `brochure_expires_at` reset before sending.
- AC10: Admin can add a manual interest row with `send_brochure = true` from the Interests page add modal.

---

## 2. Configurable Link Expiry

### What
All time-limited tokens (training plan download, course brochure) have their durations managed via a `perfxcel.settings` table rather than hardcoded values. An admin Settings page allows changing them without a code deploy.

### Why
The training plan email currently says "valid for exactly 72 hours" — this copy is incorrect and the expiry is inconsistent. Expiry needs to be visible, accurate, and changeable by an admin.

### User stories
- As an admin, I can navigate to **Settings** and change the expiry days for Training Plan links and Brochure links independently.
- As a developer, the expiry calculation reads from `perfxcel.settings` at request time so no redeploy is needed to change it.

### Acceptance criteria
- AC1: `perfxcel.settings` table exists with columns `setting_key` (text PK) and `setting_value` (jsonb).
- AC2: Two seed rows exist: `training_plan_expiry_days = 180` and `brochure_expiry_days = 180`.
- AC3: `requestTrainingPlan` reads expiry from the settings table; falls back to 180 if missing.
- AC4: Brochure token generation reads `brochure_expiry_days` from the settings table.
- AC5: Email copy accurately reflects the configured duration in human-friendly form (e.g. "6 months" not "180 days").
- AC6: Admin Settings page shows both expiry values as number inputs. Saving persists to DB.
- AC7: Changing the setting takes effect on the next request. Existing tokens keep their original `expires_at`.

---

## 3. Manual Entry Creation & File Resend

### What
Admins can create training plan requests and interest records manually (for offline/phone leads) and resend the associated files when a link has expired.

### Why
The resend-certificate flow for enrollments already exists. Training plans and brochures need equivalent functionality. Manual entry is needed for ops when calls or walk-ins happen.

### User stories
- As an admin, I can click **+ Add Request** on the Training Plans page and fill a modal with name, email, mobile, designation, company — the record is created and the download email is sent immediately.
- As an admin, I can click **Resend** on any training plan row. If the token is expired, a new one is generated automatically before sending.
- As an admin, I can click **Resend Brochure** on any interest row that has a brochure token.

### Acceptance criteria
- AC1: `POST /api/v1/training-plan` (admin-auth, no Turnstile) creates a record, sends the email, and returns the new record.
- AC2: `POST /api/v1/training-plan/:id/resend` checks expiry; if expired, regenerates `token` and `expires_at` before sending. Returns `{ regenerated: boolean }`.
- AC3: `POST /api/v1/interests/:id/resend-brochure` follows the same regeneration logic for brochure tokens.
- AC4: The admin Interests "Add Interest" modal has a **Send Brochure** checkbox; if checked and the course has a `brochure_url`, the brochure email is triggered on creation.
- AC5: Resend buttons show per-row loading and success/error feedback, using the same pattern as Resend Certificate in `Enrollments.tsx`.

---

## 4. Delete & Bulk Delete — Interests and Training Plans

### What
Admins can select and delete individual rows or batches in the Interests and Training Plans tables to clean up spam entries.

### Design decision — soft delete only (this sprint) + hard delete (next section)
Training plan requests and course interests contain PII. Soft delete (`is_deleted = true`, `deleted_at = now()`) is implemented in this sprint. Hard delete (GDPR right-to-erasure) is also in scope — see Section 9.

### User stories
- As an admin, I can select one or more rows in the Interests table and click **Delete Selected** to soft-delete them.
- As an admin, I can delete a single row via a trash icon in the row actions.
- As an admin, I can do the same on the Training Plans page.

### Acceptance criteria
- AC1: `DELETE /api/v1/interests` accepts `{ ids: string[] }` in the body and soft-deletes all matching records. Requires auth + tenant.
- AC2: `DELETE /api/v1/training-plan` follows the same pattern.
- AC3: Both `GET` list endpoints filter `is_deleted = false` by default. `include_deleted=true` query param (admin only) bypasses this.
- AC4: Both admin list pages show a checkbox column on the left of each row.
- AC5: When one or more rows are selected, a red **Delete Selected (n)** button appears in the toolbar.
- AC6: Deletion is guarded by `ConfirmationModal` with `isDestructive={true}`.
- AC7: Single-row trash icon also triggers `ConfirmationModal`.
- AC8: After deletion the table refreshes and selection is cleared.

---

## 5. Course Outline

### What
A structured, day-by-day and module-by-module breakdown of a course's content, editable by admins and visible on the public course detail page.

### Schema decision — JSONB
A `course_outline JSONB` column on `perfxcel.courses` is used rather than normalised tables (`course_days`, `course_modules`). The outline is always read and written as a whole document. No need to query individual module rows. JSONB matches how the frontend consumes it and avoids extra joins.

### JSONB shape
```json
[
  {
    "day": 1,
    "title": "Foundations of Leadership",
    "modules": [
      { "title": "Module 1: Introduction", "description": "Overview of core principles.", "duration": "2h" },
      { "title": "Module 2: Self-Assessment", "description": "Evaluating personal leadership style.", "duration": "1.5h" }
    ]
  }
]
```

### User stories
- As an admin, I can add, reorder, and remove Days in the Course Editor, and within each day add, edit, and remove Modules.
- As a visitor, I can see the day-wise outline on the course detail page in an accordion layout.

### Acceptance criteria
- AC1: `courses` table has a `course_outline JSONB` column, default `null`.
- AC2: `GET /api/v1/courses/:id` includes `course_outline` in the response.
- AC3: `POST` and `PUT` `/api/v1/courses` accept and persist `course_outline`.
- AC4: Zod validates the outline shape before insert/update (days array → modules array, required titles).
- AC5: `CourseForm.tsx` has a **Course Outline** section below Schedules with dynamic add/remove for Days and Modules using plain React state (no `react-hook-form` — it is not in the dependency tree).
- AC6: Days can be reordered by drag-and-drop using the existing `@dnd-kit/sortable` dependency.
- AC7: `CourseDetail.tsx` renders the outline in an accordion when present (`<details>/<summary>` per day).
- AC8: `Course` interface in `perfxcel-admin/src/lib/api.ts` and `perfxcel-app/src/types/course.ts` includes `course_outline`.
- AC9: The outline section on the public page is hidden if `course_outline` is null or an empty array.

---

## 6. Audit Logging

### What
Track significant actions platform-wide and surface them in the existing Audit Logs page.

### Architecture note
`perfxcel-api` already proxies audit log reads and writes to `portal-api` via `PORTAL_API_URL` (`src/routes/auditLogs.ts`). New audit events follow this same proxy — a `logAuditEvent()` utility POSTs to `${PORTAL_API_URL}/api/v1/audit-logs`. It is fire-and-forget: failure must not block or fail the primary operation.

### Actor for public submissions
Public endpoints (`registerInterest`, `requestTrainingPlan`, `submitContact`) have no authenticated user. Use `actor_id = "system"` and include the submitter's email in `details` so entries remain traceable.

### Events to log

| Event constant | Trigger | Entity type | Details |
|---|---|---|---|
| `FORM_SUBMITTED` | `registerInterest`, `requestTrainingPlan`, `submitContact` | `course_interest` / `training_plan_request` / `enquiry` | `{ name, email, course_id? }` |
| `EMAIL_SENT` | Any send/resend of training plan, brochure, or certificate | `training_plan_request` / `course_interest` / `enrollment` | `{ to, type, regenerated }` |
| `INTEREST_STATUS_CHANGED` | `updateInterestStatus` | `course_interest` | `{ from, to }` |
| `ENROLLMENT_STATUS_CHANGED` | `updateEnrollmentStatus` | `enrollment` | `{ from, to, triggered_certificate }` |
| `ENROLLMENT_CREATED` | `createEnrollment` | `enrollment` | `{ interest_id, course_title }` |
| `RECORD_DELETED` | Bulk or single delete of interests/training plans | `course_interest` / `training_plan_request` | `{ ids, count }` |
| `COURSE_CREATED` | `createCourse` | `course` | `{ title, short_code }` |
| `COURSE_UPDATED` | `updateCourse` | `course` | `{ title, changed_fields }` |

### Acceptance criteria
- AC1: `src/utils/auditLogger.ts` exports a `logAuditEvent(params)` function that POSTs to portal-api and never throws.
- AC2: All 8 event types in the table above are emitted from their respective controllers.
- AC3: Public-form events use `actor_id = "system"` and include the submitter's email in `details`.
- AC4: The admin Audit Logs page gains an **Entity Type** filter dropdown.
- AC5: The Audit Logs table gains a **Details** column with an expandable `<details>/<pre>` JSON viewer.
- AC6: Audit writes never block or fail the primary operation if portal-api is unreachable.

---

## 7. DB Migrations Consolidation

### What
Merge all existing `perfxcel`-schema SQL migration files into a single, logically ordered master migration file that includes every schema change from this sprint.

### Why
The current state has at least two separate migration files (`20260912000000_create_perfxcel_schema.sql`, `20260921000000_add_updated_at_to_interests_enquiries.sql`) plus all new columns added in this sprint. A fresh environment provisioning (new staging, disaster recovery, or developer onboarding) would have to apply each file in sequence. A single consolidated file is the source of truth.

### User stories
- As a developer onboarding to the project, I can run a single SQL file against a blank Supabase project and get a fully provisioned `perfxcel` schema.
- As a DBA, I can verify all table definitions, triggers, RLS policies, and grants are in one place.

### Acceptance criteria
- AC1: A single file `supabase/migrations/perfxcel_master.sql` (or equivalent named file) exists in `perfxcel-api` and contains all `perfxcel`-schema DDL in logical dependency order: extensions → tables → indexes → triggers → RLS policies → grants.
- AC2: The consolidated file includes all new columns and tables added in this sprint: `course_outline`, `brochure_url`, `brochure_token`, `brochure_expires_at`, `is_deleted`, `deleted_at` on interests and training plans, and the `settings` table.
- AC3: The consolidated file has been applied to both `dev` and `prod` Supabase instances and verified clean (no errors).
- AC4: Applying the consolidated file to a blank database produces an identical schema to the current production database.
- AC5: Individual historical migration files are retained in a `supabase/migrations/archive/` directory for audit history but are no longer the primary reference.

---

## 8. dot-docs Documentation Update

### What
Update the central technical documentation in `dot-docs` to accurately reflect the new features introduced in this sprint.

### Why
The `dot-docs` site is the internal reference for how the Perfxcel platform works. Without updates, other developers and future contributors will find stale or missing information about: the brochure flow, configurable expiry, JSONB course outline, hard delete, and the audit logger integration.

### User stories
- As a developer joining the project, I can read the dot-docs and understand the Course Brochure flow end-to-end without reading source code.
- As a DBA, I can reference the docs to understand the `perfxcel.settings` table and what keys are valid.
- As an engineer, I can read how `auditLogger.ts` works and what event types exist, without opening the codebase.

### Pages to create or update

| Page | Action | Location |
|---|---|---|
| Course Brochure Flow | **New** | `public/docs/perfxcel/features/course-brochure.md` |
| Configurable Link Expiry | **New** | `public/docs/perfxcel/features/link-expiry-settings.md` |
| Course Outline (JSONB) | **New** | `public/docs/perfxcel/features/course-outline.md` |
| Audit Logging | **New** | `private/docs/perfxcel/architecture/audit-logging.md` |
| Hard Delete / GDPR Erasure | **New** | `private/docs/perfxcel/architecture/gdpr-erasure.md` |
| DB Schema Reference | **Update** | `private/docs/perfxcel/database/schema.md` |
| API Endpoint Reference | **Update** | `public/docs/perfxcel/api/endpoints.md` |

### Acceptance criteria
- AC1: All new pages listed above are created with accurate content matching the implemented behaviour.
- AC2: Each new page is registered in the appropriate `mkdocs.yml` `nav` section.
- AC3: The DB schema reference reflects all new columns and the `settings` table.
- AC4: The API endpoint reference covers all new routes: `GET /interests/brochure/:token`, `POST /interests/:id/resend-brochure`, `DELETE /interests`, `DELETE /training-plan`, `POST /training-plan/:id/resend`, `POST /api/v1/interests`, `GET /api/v1/settings`, `PATCH /api/v1/settings`, `POST /interests/:id/hard-delete`.
- AC5: The audit logging page documents all 8 event constants, their `entity_type`, and their `details` shape.
- AC6: Public pages contain no internal architecture details, deployment secrets, or database schemas.
- AC7: Running `cd public && mkdocs build` and `cd private && mkdocs build` complete without errors.

---

## 9. Hard Delete (GDPR / Right to Erasure)

### What
A permanent, irreversible erasure of PII from `course_interests` and `training_plan_requests` records. This goes beyond soft-delete: the actual name, email, phone, company, and mobile fields are overwritten with anonymised placeholders, and a `GDPR_ERASURE` audit event is recorded before the data is destroyed.

### Why
GDPR and similar regulations grant data subjects the right to have their personal data erased. Soft delete is insufficient — the data still exists in the database. Hard delete provides a compliant erasure path while keeping the record skeleton for referential integrity (so that enrollment and certificate references do not break).

### Design decision — anonymisation over row deletion
Rather than physically deleting the row (which would cascade-break `enrollments.interest_id` foreign keys), PII fields are overwritten with `[deleted]` / `null` and the row is flagged `is_hard_deleted = true`. This preserves referential integrity while making the record non-personally-identifiable.

### Hard-deleted record shape

```
name:        "[deleted]"
email:       "[deleted]"
phone:       null
company:     null
mobile:      null (training_plan_requests only)
designation: null (training_plan_requests only)
is_deleted:     true
is_hard_deleted: true
deleted_at:  <original soft-delete timestamp or now()>
hard_deleted_at: <now()>
```

### User stories
- As an admin, I can select one or more interest or training plan records and click **Erase PII** to permanently anonymise the personal data.
- As an admin, I see a two-step confirmation warning me that this action is permanent and irreversible and cannot be undone.
- As a data subject, my personal data is removed from the system on request within the legally required timeframe.
- As an auditor, I can see a `GDPR_ERASURE` event in the audit log confirming erasure was performed, by whom, and when.

### Acceptance criteria
- AC1: `course_interests` table gains `is_hard_deleted BOOLEAN NOT NULL DEFAULT FALSE` and `hard_deleted_at TIMESTAMPTZ DEFAULT NULL` columns.
- AC2: `training_plan_requests` table gains the same two columns.
- AC3: `POST /api/v1/interests/:id/hard-delete` (protected, auth + tenant) overwrites PII fields with `[deleted]`/null, sets `is_hard_deleted = true`, `hard_deleted_at = now()`, `is_deleted = true`.
- AC4: `POST /api/v1/training-plan/:id/hard-delete` follows the same pattern.
- AC5: Both endpoints emit a `GDPR_ERASURE` audit event with `actor_id`, `entity_type`, `entity_id`, and `details: { fields_erased: ["name","email",...] }`.
- AC6: `GET /api/v1/interests` and `GET /api/v1/training-plan` always exclude `is_hard_deleted = true` rows regardless of `include_deleted` param.
- AC7: The admin UI shows a **Erase PII** option in the row actions of Interests and Training Plans. It is visually distinct from the soft-delete trash icon (e.g. a `ShieldX` or `UserX` icon, red, with tooltip "Permanently erase personal data").
- AC8: The confirmation modal renders `isDestructive={true}` with the message: "This will permanently erase all personal data (name, email, phone, company) for this record. The record structure is retained for referential integrity. **This cannot be undone.**"
- AC9: Hard-deleted rows that happen to appear in a list (e.g. via `include_deleted=true`) show `[deleted]` in name and email cells with a `ShieldOff` badge.

---

## 10. `react-hook-form` for Course Outline Builder

### What
Use `react-hook-form` in `CourseForm.tsx` to manage the Course Outline dynamic form section (nested day → module arrays), replacing the ad-hoc `useState` + manual array manipulation approach.

### Why
The Course Outline builder has a three-level nested structure: course → days → modules. Managing nested arrays with plain `useState` (add/remove/update/reorder at multiple levels) is verbose and error-prone. `react-hook-form` with `useFieldArray` handles nested arrays natively, provides form-level validation, and keeps the code maintainable as the outline grows more complex.

### User stories
- As a developer, I can use `useFieldArray` for the `outline` array and nested `modules` sub-arrays so that add/remove/update operations are handled by the library, not manual array splicing.
- As an admin, the outline form behaves consistently with the rest of the form (same submit, same validation errors, same reset on cancel).

### Acceptance criteria
- AC1: `react-hook-form` is added to `perfxcel-admin/package.json` as a regular dependency.
- AC2: `CourseForm.tsx` uses `useForm` from `react-hook-form` for the entire course form, not just the outline section. This replaces the current ~15 individual `useState` declarations for form fields.
- AC3: The outline section uses `useFieldArray` for days, and a nested `useFieldArray` (scoped per day) for modules.
- AC4: Drag-and-drop reordering of days calls `move()` from the day `useFieldArray` rather than manually reordering a plain array.
- AC5: Zod validation of the outline (`courseOutlineSchema`) is wired via `@hookform/resolvers/zod` as the form resolver. Validation errors surface inline next to the relevant field.
- AC6: `@hookform/resolvers` is added to `perfxcel-admin/package.json`.
- AC7: The existing `@dnd-kit/sortable` integration for day reordering is retained — `react-hook-form` manages the data; `@dnd-kit` manages the drag UI.
- AC8: All TypeScript types are correct — no `any` without justification.

---

## Previous Out of Scope Section

This sprint now includes all previously deferred items. There are no remaining out-of-scope items.
