import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
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

// Admin routes — require JWT
router.get("/", requireAuth, asyncHandler(getCourses));
router.get("/:id", requireAuth, asyncHandler(getCourse));
router.post("/", requireAuth, asyncHandler(createCourse));
router.put("/:id", requireAuth, asyncHandler(updateCourse));
router.patch("/bulk", requireAuth, asyncHandler(bulkUpdateCourses));
router.delete("/:id", requireAuth, asyncHandler(deleteCourse));

export default router;
