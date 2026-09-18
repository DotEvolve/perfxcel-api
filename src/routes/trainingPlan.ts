import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { requirePerfxcelTenant } from "../middleware/tenant";
import { requestTrainingPlan, downloadTrainingPlan, getTrainingPlanRequests } from "../controllers/trainingPlanController";

const router = Router();

router.get("/", requireAuth, requirePerfxcelTenant, asyncHandler(getTrainingPlanRequests));
router.post("/request", asyncHandler(requestTrainingPlan));
router.get("/download/:token", asyncHandler(downloadTrainingPlan));

export default router;
