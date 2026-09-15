import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { verifyCertificate, downloadCertificate } from "../controllers/verifyController";

const router = Router();

router.post("/", asyncHandler(verifyCertificate));
router.get("/:id/pdf", asyncHandler(downloadCertificate));

export default router;
