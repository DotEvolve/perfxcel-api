import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import {
  getInterests,
  updateInterestStatus,
} from "../controllers/interestController";

const router = Router();

// Admin routes
router.get("/", asyncHandler(getInterests));
router.patch("/:id", asyncHandler(updateInterestStatus));

export default router;
