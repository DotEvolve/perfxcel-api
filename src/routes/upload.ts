import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { requirePerfxcelTenant } from "../middleware/tenant";
import {
  uploadTrainingPlan,
  downloadTrainingPlan,
  uploadCourseBrochure,
} from "../controllers/uploadController";

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      cb(new Error("Only PDF files are allowed"));
    } else {
      cb(null, true);
    }
  },
});

const router = Router();
router.post(
  "/training-plan",
  requireAuth,
  requirePerfxcelTenant,
  pdfUpload.single("file"),
  asyncHandler(uploadTrainingPlan),
);
router.get(
  "/training-plan/download",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(downloadTrainingPlan),
);
router.post(
  "/course-brochure",
  requireAuth,
  requirePerfxcelTenant,
  pdfUpload.single("file"),
  asyncHandler(uploadCourseBrochure),
);

export default router;
