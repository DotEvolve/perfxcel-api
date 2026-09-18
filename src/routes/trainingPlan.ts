import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requestTrainingPlan, downloadTrainingPlan } from "../controllers/trainingPlanController";

const router = Router();

router.post("/request", asyncHandler(requestTrainingPlan));
router.get("/download/:token", asyncHandler(downloadTrainingPlan));

export default router;
