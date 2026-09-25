import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { requirePerfxcelTenant } from "../middleware/tenant";
import { getSettings, updateSettings } from "../controllers/settingsController";

const router = Router();

router.get("/", requireAuth, requirePerfxcelTenant, asyncHandler(getSettings));
router.put(
  "/",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(updateSettings),
);

export default router;
