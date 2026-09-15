import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import {
  getInterests,
  updateInterestStatus,
} from "../controllers/interestController";

const router = Router();

router.get("/", requireAuth, asyncHandler(getInterests));
router.patch("/:id", requireAuth, asyncHandler(updateInterestStatus));

export default router;
