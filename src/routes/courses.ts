import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { requirePerfxcelTenant } from "../middleware/tenant";
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

const validateCourseInput = (req: any, res: any, next: any) => {
  const { status, is_public } = req.body;
  if (status && !['active', 'archived'].includes(status)) {
    return next(new AppError("Invalid status. Must be active or archived.", 400, ErrorCategory.VALIDATION));
  }
  if (is_public !== undefined && typeof is_public !== 'boolean') {
    return next(new AppError("is_public must be a boolean", 400, ErrorCategory.VALIDATION));
  }
  next();
};

// Public — tenant-facing interest registration
router.post("/:id/interest", asyncHandler(registerInterest));

// Public routes
router.get("/", asyncHandler(getCourses));
router.get("/:id", asyncHandler(getCourse));

// Admin routes — require JWT
router.post("/", requireAuth, requirePerfxcelTenant, validateCourseInput, asyncHandler(createCourse));
router.put("/:id", requireAuth, requirePerfxcelTenant, validateCourseInput, asyncHandler(updateCourse));
router.patch("/bulk", requireAuth, requirePerfxcelTenant, asyncHandler(bulkUpdateCourses));
router.delete("/:id", requireAuth, requirePerfxcelTenant, asyncHandler(deleteCourse));

export default router;
