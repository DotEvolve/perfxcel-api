import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { requirePerfxcelTenant } from "../middleware/tenant";
import { validateBody } from "../middleware/validate";
import { interestStatusSchema } from "../validators/schemas";
import {
  getInterests,
  updateInterestStatus,
} from "../controllers/interestController";

const router = Router();

router.get("/", requireAuth, requirePerfxcelTenant, asyncHandler(getInterests));
router.patch(
  "/:id",
  requireAuth,
  requirePerfxcelTenant,
  validateBody(interestStatusSchema),
  asyncHandler(updateInterestStatus),
);

export default router;
