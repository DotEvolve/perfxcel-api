import { Request, Response } from "express";
import { supabase } from "../db/supabase";
import { NotFoundError, AppError, ErrorCategory } from "@dotevolve/error-utils";

export const getCourses = async (req: Request, res: Response) => {
  const { category_id, city_id, association_id } = req.query;

  let query = supabase
    .from("courses")
    .select("*, categories(*), cities(*), associations(*)");

  if (category_id) query = query.eq("category_id", category_id);
  if (city_id) query = query.eq("city_id", city_id);
  if (association_id) query = query.eq("association_id", association_id);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new AppError(error.message, 500, ErrorCategory.SYSTEM);
  }

  res.status(200).json({
    status: "success",
    results: data.length,
    data,
  });
};

export const getCourse = async (req: Request, res: Response) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("courses")
    .select("*, categories(*), cities(*), associations(*)")
    .eq("id", id)
    .single();

  if (error) {
    throw new AppError(error.message, 500, ErrorCategory.SYSTEM);
  }

  if (!data) {
    throw new NotFoundError("Course not found");
  }

  res.status(200).json({
    status: "success",
    data,
  });
};

export const createCourse = async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from("courses")
    .insert([req.body])
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  res.status(201).json({
    status: "success",
    data,
  });
};

export const updateCourse = async (req: Request, res: Response) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("courses")
    .update(req.body)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  if (!data) {
    throw new NotFoundError("Course not found");
  }

  res.status(200).json({
    status: "success",
    data,
  });
};

export const deleteCourse = async (req: Request, res: Response) => {
  const { id } = req.params;

  const { error } = await supabase.from("courses").delete().eq("id", id);

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  res.status(204).send();
};

export const registerInterest = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, email, phone, company, turnstileToken } = req.body;

  if (!turnstileToken) {
    throw new AppError("Turnstile token is missing", 400, ErrorCategory.VALIDATION);
  }

  const expectedHostnames = new Set(
    (process.env.VITE_PERFXCEL_TURNSTILE_HOSTNAMES ?? "dev.perfxcel.com,perfxcel.com")
      .split(",")
      .map((hostname) => hostname.trim())
      .filter(Boolean),
  );

  let result;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: process.env.VITE_PERFXCEL_TURNSTILE_SECRET_KEY || "",
        response: turnstileToken,
        remoteip: req.ip || "",
      }),
    });
    if (!r.ok) throw new Error(`siteverify ${r.status}`);
    result = await r.json();
  } catch (err) {
    throw new AppError("Failed to verify Turnstile token", 500, ErrorCategory.SYSTEM);
  }

  if (
    !result.success ||
    !expectedHostnames.has(result.hostname)
  ) {
    throw new AppError("Invalid Turnstile token", 403, ErrorCategory.AUTHENTICATION);
  }

  const { data, error } = await supabase
    .from("course_interests")
    .insert([{ course_id: id, name, email, phone, company }])
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  res.status(201).json({
    status: "success",
    data,
  });
};
