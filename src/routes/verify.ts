import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { verifyCertificate } from "../controllers/verifyController";

const router = Router();

router.post("/", asyncHandler(verifyCertificate));

export default router;
