import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { getDashboardMetrics } from "../controllers/metricsController";

const router = Router();

// TODO: Add requireAuth middleware before going to production
router.get("/", asyncHandler(getDashboardMetrics));

export default router;
