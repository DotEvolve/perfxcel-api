import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { requirePerfxcelTenant } from "../middleware/tenant";
import { validateBody } from "../middleware/validate";
import { trainingPlanSchema } from "../validators/schemas";
import { requestTrainingPlan, downloadTrainingPlan, getTrainingPlanRequests } from "../controllers/trainingPlanController";
import { strictLimiter } from "../middleware/rateLimiter";

const router = Router();

router.get("/", requireAuth, requirePerfxcelTenant, asyncHandler(getTrainingPlanRequests));
router.post("/request", strictLimiter, validateBody(trainingPlanSchema), asyncHandler(requestTrainingPlan));
router.get("/download/:token", asyncHandler(downloadTrainingPlan));

export default router;
