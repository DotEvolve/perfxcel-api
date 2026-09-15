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

const router = Router();

// Public — tenant-facing interest registration
router.post("/:id/interest", asyncHandler(registerInterest));

// Public routes
router.get("/", asyncHandler(getCourses));
router.get("/:id", asyncHandler(getCourse));

// Admin routes — require JWT
router.post("/", requireAuth, requirePerfxcelTenant, asyncHandler(createCourse));
router.put("/:id", requireAuth, requirePerfxcelTenant, asyncHandler(updateCourse));
router.patch("/bulk", requireAuth, requirePerfxcelTenant, asyncHandler(bulkUpdateCourses));
router.delete("/:id", requireAuth, requirePerfxcelTenant, asyncHandler(deleteCourse));

export default router;
