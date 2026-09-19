import { Router } from "express";
import {
  verifyCertificate,
  downloadCertificate,
} from "../controllers/verifyController";
import { asyncHandler } from "@dotevolve/error-utils";
import { strictLimiter } from "../middleware/rateLimiter";

const router = Router();

router.post("/", strictLimiter, asyncHandler(verifyCertificate));
router.get("/:id/pdf", asyncHandler(downloadCertificate));

export default router;
