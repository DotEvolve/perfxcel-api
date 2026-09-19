import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { validateBody } from "../middleware/validate";
import { strictLimiter } from "../middleware/rateLimiter";
import { contactSchema } from "../validators/schemas";
import { submitContact } from "../controllers/enquiryController";

const router = Router();

router.post("/", strictLimiter, validateBody(contactSchema), asyncHandler(submitContact));

export default router;
