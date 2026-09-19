import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { requirePerfxcelTenant } from "../middleware/tenant";
import {
  getEnrollments,
  createEnrollment,
  updateEnrollmentStatus,
  resendCertificate,
} from "../controllers/enrollmentController";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(getEnrollments),
);
router.post(
  "/",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(createEnrollment),
);
router.patch(
  "/:id",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(updateEnrollmentStatus),
);

router.post(
  "/:id/resend-certificate",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(resendCertificate),
);

export default router;
