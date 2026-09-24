import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { requirePerfxcelTenant } from "../middleware/tenant";
import { validateBody } from "../middleware/validate";
import { interestStatusSchema } from "../validators/schemas";
import {
  getInterests,
  updateInterestStatus,
  downloadBrochure,
  createInterestManual,
  resendBrochure,
  deleteInterests,
  hardDeleteInterest
} from "../controllers/interestController";

const router = Router();

router.get("/brochure/:token", asyncHandler(downloadBrochure));

router.get("/", requireAuth, requirePerfxcelTenant, asyncHandler(getInterests));
router.post("/", requireAuth, requirePerfxcelTenant, asyncHandler(createInterestManual));
router.delete("/", requireAuth, requirePerfxcelTenant, asyncHandler(deleteInterests));

router.patch(
  "/:id",
  requireAuth,
  requirePerfxcelTenant,
  validateBody(interestStatusSchema),
  asyncHandler(updateInterestStatus),
);

router.post("/:id/resend-brochure", requireAuth, requirePerfxcelTenant, asyncHandler(resendBrochure));
router.post("/:id/hard-delete", requireAuth, requirePerfxcelTenant, asyncHandler(hardDeleteInterest));

export default router;
