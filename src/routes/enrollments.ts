import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { getEnrollments, createEnrollment, updateEnrollmentStatus } from "../controllers/enrollmentController";

const router = Router();

router.get("/", asyncHandler(getEnrollments));
router.post("/", asyncHandler(createEnrollment));
router.patch("/:id", asyncHandler(updateEnrollmentStatus));

export default router;
