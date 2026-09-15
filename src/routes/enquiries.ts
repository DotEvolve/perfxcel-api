import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { requirePerfxcelTenant } from "../middleware/tenant";
import { getEnquiries, updateEnquiryStatus } from "../controllers/enquiryController";

const router = Router();

router.get("/", requireAuth, requirePerfxcelTenant, asyncHandler(getEnquiries));
router.patch("/:id", requireAuth, requirePerfxcelTenant, asyncHandler(updateEnquiryStatus));

export default router;
