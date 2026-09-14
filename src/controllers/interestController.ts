import { Request, Response } from "express";
import { supabase } from "../db/supabase";
import { NotFoundError, AppError, ErrorCategory } from "@dotevolve/error-utils";

export const getInterests = async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from("course_interests")
    .select("*, courses(title)")
    .order("created_at", { ascending: false });

  if (error) {
    throw new AppError(error.message, 500, ErrorCategory.SYSTEM);
  }

  res.status(200).json({
    status: "success",
    results: data.length,
    data,
  });
};

export const updateInterestStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  const { data, error } = await supabase
    .from("course_interests")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  if (!data) {
    throw new NotFoundError("Interest not found");
  }

  res.status(200).json({
    status: "success",
    data,
  });
};
