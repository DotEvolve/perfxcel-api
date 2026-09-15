import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { getDashboardMetrics } from "../controllers/metricsController";

const router = Router();

router.get("/", requireAuth, asyncHandler(getDashboardMetrics));

export default router;
