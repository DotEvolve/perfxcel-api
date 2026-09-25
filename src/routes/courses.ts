import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { requirePerfxcelTenant } from "../middleware/tenant";
import { validateBody } from "../middleware/validate";
import { interestSchema, courseInputSchema } from "../validators/schemas";
import { strictLimiter } from "../middleware/rateLimiter";
import {
  getCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  registerInterest,
  bulkUpdateCourses,
} from "../controllers/courseController";
import { AppError, ErrorCategory } from "@dotevolve/error-utils";

const router = Router();

// Validate course using zod in routes below instead of validateCourseInput.

// Static-segment routes first — must be above /:id to prevent dynamic capture
router.get("/", asyncHandler(getCourses));
router.post(
  "/",
  requireAuth,
  requirePerfxcelTenant,
  validateBody(courseInputSchema),
  asyncHandler(createCourse),
);
router.patch(
  "/bulk",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(bulkUpdateCourses),
);

// Dynamic-segment routes
router.post(
  "/:id/interest",
  strictLimiter,
  validateBody(interestSchema),
  asyncHandler(registerInterest),
);
router.get("/:id", asyncHandler(getCourse));
router.put(
  "/:id",
  requireAuth,
  requirePerfxcelTenant,
  validateBody(courseInputSchema),
  asyncHandler(updateCourse),
);
router.delete(
  "/:id",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(deleteCourse),
);

export default router;
