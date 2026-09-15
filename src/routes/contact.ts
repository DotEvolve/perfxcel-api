import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { submitContact } from "../controllers/enquiryController";

const router = Router();

router.post("/", asyncHandler(submitContact));

export default router;
