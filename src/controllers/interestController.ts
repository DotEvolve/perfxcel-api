import { Request, Response } from "express";
import { supabase } from "../db/supabase";
import { NotFoundError, AppError, ErrorCategory } from "@dotevolve/error-utils";

export const getInterests = async (req: Request, res: Response) => {
  const { status, course_id, search, sort, page, limit } = req.query;

  let query = supabase
    .from("course_interests")
    .select("*, courses(title)", { count: "exact" });

  if (status) {
    const statuses = Array.isArray(status) ? status : [status];
    query = query.in("status", statuses);
  }

  if (course_id) {
    const courseIds = Array.isArray(course_id) ? course_id : [course_id];
    query = query.in("course_id", courseIds);
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,company.ilike.%${search}%`);
  }

  if (sort) {
    const [field, order] = (sort as string).split(":");
    query = query.order(field, { ascending: order === "asc" });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const pageNum = parseInt(page as string) || 1;
  const limitNum = parseInt(limit as string) || 20;
  const from = (pageNum - 1) * limitNum;
  const to = from + limitNum - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;

  if (error) {
    throw new AppError(error.message, 500, ErrorCategory.SYSTEM);
  }

  res.status(200).json({
    status: "success",
    results: data.length,
    total: count,
    page: pageNum,
    limit: limitNum,
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
