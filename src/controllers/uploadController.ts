import { Request, Response } from "express";
import { perfxcelSupabase } from "../db/supabase";
import { AppError, ErrorCategory, NotFoundError } from "@dotevolve/error-utils";

export const uploadTrainingPlan = async (req: Request, res: Response) => {
  if (!req.file) throw new AppError("No file provided", 400, ErrorCategory.VALIDATION);

  const { error } = await perfxcelSupabase.storage
    .from("assets")
    .upload("training_plan.pdf", req.file.buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) throw new AppError(error.message, 500, ErrorCategory.SYSTEM);

  const url = `${process.env.PERFXCEL_API_URL}/api/v1/upload/training-plan/download`;
  res.status(200).json({ status: "success", data: { url } });
};

export const downloadTrainingPlan = async (_req: Request, res: Response) => {
  const { data, error } = await perfxcelSupabase.storage
    .from("assets")
    .download("training_plan.pdf");

  if (error || !data) throw new NotFoundError("Training plan not found");

  const arrayBuffer = await data.arrayBuffer();
  res.setHeader("Content-Type", data.type || "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="training_plan.pdf"');
  res.status(200).send(Buffer.from(arrayBuffer));
};

export const uploadCourseBrochure = async (req: Request, res: Response) => {
  if (!req.file) throw new AppError("No file provided", 400, ErrorCategory.VALIDATION);

  const { short_code } = req.body;
  if (!short_code) throw new AppError("short_code is required", 400, ErrorCategory.VALIDATION);

  const filename = `${short_code}.pdf`;
  const { error } = await perfxcelSupabase.storage
    .from("course-brochures")
    .upload(filename, req.file.buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) throw new AppError(error.message, 500, ErrorCategory.SYSTEM);

  const { data: urlData } = perfxcelSupabase.storage
    .from("course-brochures")
    .getPublicUrl(filename);

  const frontendUrl = process.env.PERFXCEL_FRONTEND_URL || (process.env.NODE_ENV === "production" ? "https://perfxcel.com" : "https://dev.perfxcel.com");
  const url = `${frontendUrl}${process.env.API_VERSION || "/api/v1"}/interests/brochure/by-course/${short_code}`;

  res.status(200).json({ status: "success", data: { url, filename } });
};
