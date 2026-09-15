import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import {
  getEnrollments,
  createEnrollment,
  updateEnrollmentStatus,
} from "../controllers/enrollmentController";

const router = Router();

router.get("/", requireAuth, asyncHandler(getEnrollments));
router.post("/", requireAuth, asyncHandler(createEnrollment));
router.patch("/:id", requireAuth, asyncHandler(updateEnrollmentStatus));

export default router;
