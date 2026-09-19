import { Request, Response } from "express";
import { supabase } from "../db/supabase";
import { NotFoundError, AppError, ErrorCategory } from "@dotevolve/error-utils";
import { computeIsBlended } from "../utils/course";

const generateUniqueSlug = async (
  baseText: string,
  currentId?: string,
): Promise<string> => {
  const baseSlug = baseText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    let query = supabase.from("courses").select("id").eq("slug", slug);
    if (currentId) {
      query = query.neq("id", currentId);
    }
    const { data, error } = await query;
    if (error)
      throw new AppError(
        "Error checking slug uniqueness",
        500,
        ErrorCategory.SYSTEM,
      );

    if (!data || data.length === 0) {
      break;
    }
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
};

const fetchCourseWithRelations = async (identifier: string) => {
  const isUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      identifier,
    );

  let query = supabase.from("courses").select(`
      *,
      course_categories(categories(*)),
      course_cities(cities(*)),
      course_associations(associations(*)),
      course_delivery_modes(delivery_modes(*)),
      course_schedules(*)
    `);

  if (isUUID) {
    query = query.eq("id", identifier);
  } else {
    query = query.eq("slug", identifier);
  }

  const { data, error } = await query.single();

  if (error) throw error;
  if (!data) return null;

  return {
    ...data,
    categories: data.course_categories
      ?.map((j: any) => j.categories)
      .filter(Boolean),
    cities: data.course_cities?.map((j: any) => j.cities).filter(Boolean),
    associations: data.course_associations
      ?.map((j: any) => j.associations)
      .filter(Boolean),
    delivery_modes: data.course_delivery_modes
      ?.map((j: any) => j.delivery_modes)
      .filter(Boolean),
    is_blended: computeIsBlended(
      data.course_delivery_modes?.map((j: any) => j.delivery_modes?.name),
    ),
    course_categories: undefined,
    course_cities: undefined,
    course_associations: undefined,
    course_delivery_modes: undefined,
  };
};

export const getCourses = async (req: Request, res: Response) => {
  const {
    category_ids,
    city_ids,
    association_ids,
    delivery_mode_ids,
    search,
    sort,
    page,
    limit,
    include_deleted,
    status,
    is_public,
  } = req.query;

  const innerCat = category_ids ? "!inner" : "";
  const innerCity = city_ids ? "!inner" : "";
  const innerAssoc = association_ids ? "!inner" : "";
  const innerDelivery = delivery_mode_ids ? "!inner" : "";

  let query = supabase.from("courses").select(
    `
      *,
      course_categories${innerCat}(category_id, categories(*)),
      course_cities${innerCity}(city_id, cities(*)),
      course_associations${innerAssoc}(association_id, associations(*)),
      course_delivery_modes${innerDelivery}(delivery_mode_id, delivery_modes(*)),
      course_schedules(*)
    `,
    { count: "exact" },
  );

  if (category_ids) {
    const ids = Array.isArray(category_ids) ? category_ids : [category_ids];
    query = query.in("course_categories.category_id", ids);
  }
  if (city_ids) {
    const ids = Array.isArray(city_ids) ? city_ids : [city_ids];
    query = query.in("course_cities.city_id", ids);
  }
  if (association_ids) {
    const ids = Array.isArray(association_ids)
      ? association_ids
      : [association_ids];
    query = query.in("course_associations.association_id", ids);
  }
  if (delivery_mode_ids) {
    const ids = Array.isArray(delivery_mode_ids)
      ? delivery_mode_ids
      : [delivery_mode_ids];
    query = query.in("course_delivery_modes.delivery_mode_id", ids);
  }

  if (include_deleted !== "true") {
    query = query.neq("status", "deleted");
  }

  if (status) {
    query = query.eq("status", status);
  }

  if (is_public === "true") {
    query = query.eq("is_public", true);
  }

  if (search) {
    query = query.ilike("title", `%${search}%`);
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

  const transformed = data.map((row) => ({
    ...row,
    categories: row.course_categories
      ?.map((j: any) => j.categories)
      .filter(Boolean),
    cities: row.course_cities?.map((j: any) => j.cities).filter(Boolean),
    associations: row.course_associations
      ?.map((j: any) => j.associations)
      .filter(Boolean),
    delivery_modes: row.course_delivery_modes
      ?.map((j: any) => j.delivery_modes)
      .filter(Boolean),
    is_blended: computeIsBlended(
      row.course_delivery_modes?.map((j: any) => j.delivery_modes?.name),
    ),
    course_categories: undefined,
    course_cities: undefined,
    course_associations: undefined,
    course_delivery_modes: undefined,
  }));

  res.status(200).json({
    status: "success",
    results: transformed.length,
    total: count,
    page: pageNum,
    limit: limitNum,
    data: transformed,
  });
};

export const getCourse = async (req: Request, res: Response) => {
  const id = req.params.id as string;

  try {
    const fullCourse = await fetchCourseWithRelations(id);
    if (!fullCourse) throw new NotFoundError("Course not found");

    res.status(200).json({
      status: "success",
      data: fullCourse,
    });
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw new AppError(err.message, 500, ErrorCategory.SYSTEM);
  }
};

export const createCourse = async (req: Request, res: Response) => {
  const {
    category_ids,
    city_ids,
    association_ids,
    delivery_mode_ids,
    schedules,
    slug: inputSlug,
    ...coreFields
  } = req.body;

  const finalSlug = await generateUniqueSlug(inputSlug || coreFields.title);

  const { data: course, error } = await supabase
    .from("courses")
    .insert([{ ...coreFields, slug: finalSlug }])
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  await Promise.all(
    [
      category_ids?.length > 0 &&
        supabase
          .from("course_categories")
          .insert(
            category_ids.map((id: string) => ({
              course_id: course.id,
              category_id: id,
            })),
          ),
      city_ids?.length > 0 &&
        supabase
          .from("course_cities")
          .insert(
            city_ids.map((id: string) => ({
              course_id: course.id,
              city_id: id,
            })),
          ),
      association_ids?.length > 0 &&
        supabase
          .from("course_associations")
          .insert(
            association_ids.map((id: string) => ({
              course_id: course.id,
              association_id: id,
            })),
          ),
      delivery_mode_ids?.length > 0 &&
        supabase
          .from("course_delivery_modes")
          .insert(
            delivery_mode_ids.map((id: string) => ({
              course_id: course.id,
              delivery_mode_id: id,
            })),
          ),
      schedules?.length > 0 &&
        supabase
          .from("course_schedules")
          .insert(schedules.map((s: any) => ({ ...s, course_id: course.id }))),
    ].filter(Boolean),
  );

  const full = await fetchCourseWithRelations(course.id);

  res.status(201).json({
    status: "success",
    data: full,
  });
};

export const updateCourse = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const {
    category_ids,
    city_ids,
    association_ids,
    delivery_mode_ids,
    schedules,
    slug: inputSlug,
    ...coreFields
  } = req.body;

  const finalSlug = await generateUniqueSlug(inputSlug || coreFields.title, id);

  const { data: course, error } = await supabase
    .from("courses")
    .update({ ...coreFields, slug: finalSlug })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  if (!course) {
    throw new NotFoundError("Course not found");
  }

  await Promise.all([
    supabase.from("course_categories").delete().eq("course_id", id),
    supabase.from("course_cities").delete().eq("course_id", id),
    supabase.from("course_associations").delete().eq("course_id", id),
    supabase.from("course_delivery_modes").delete().eq("course_id", id),
    supabase.from("course_schedules").delete().eq("course_id", id),
  ]);

  await Promise.all(
    [
      category_ids?.length > 0 &&
        supabase
          .from("course_categories")
          .insert(
            category_ids.map((cid: string) => ({
              course_id: id,
              category_id: cid,
            })),
          ),
      city_ids?.length > 0 &&
        supabase
          .from("course_cities")
          .insert(
            city_ids.map((cid: string) => ({ course_id: id, city_id: cid })),
          ),
      association_ids?.length > 0 &&
        supabase
          .from("course_associations")
          .insert(
            association_ids.map((cid: string) => ({
              course_id: id,
              association_id: cid,
            })),
          ),
      delivery_mode_ids?.length > 0 &&
        supabase
          .from("course_delivery_modes")
          .insert(
            delivery_mode_ids.map((cid: string) => ({
              course_id: id,
              delivery_mode_id: cid,
            })),
          ),
      schedules?.length > 0 &&
        supabase.from("course_schedules").insert(
          schedules.map((s: any) => ({
            course_id: id,
            start_date: s.start_date,
            end_date: s.end_date,
            location: s.location,
            method: s.method,
            status: s.status,
          })),
        ),
    ].filter(Boolean),
  );

  const full = await fetchCourseWithRelations(id);

  res.status(200).json({
    status: "success",
    data: full,
  });
};

export const bulkUpdateCourses = async (req: Request, res: Response) => {
  const { ids, updates } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError(
      "Invalid or empty ids array",
      400,
      ErrorCategory.VALIDATION,
    );
  }

  const { data, error } = await supabase
    .from("courses")
    .update(updates)
    .in("id", ids)
    .select();

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  res.status(200).json({
    status: "success",
    data,
  });
};

export const deleteCourse = async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const { error } = await supabase
    .from("courses")
    .update({
      status: "deleted",
      deleted_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw new AppError(error.message, 500, ErrorCategory.SYSTEM);
  }

  res.status(204).send();
};

export const registerInterest = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, email, phone, company, turnstileToken } = req.body;

  if (!turnstileToken) {
    throw new AppError(
      "Turnstile token is missing",
      400,
      ErrorCategory.VALIDATION,
    );
  }

  const expectedHostnames = new Set(
    (
      process.env.VITE_PERFXCEL_TURNSTILE_HOSTNAMES ??
      "dev.perfxcel.com,perfxcel.com"
    )
      .split(",")
      .map((hostname) => hostname.trim())
      .filter(Boolean),
  );

  let result;
  try {
    const r = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: process.env.VITE_PERFXCEL_TURNSTILE_SECRET_KEY || "",
          response: turnstileToken,
          remoteip: req.ip || "",
        }),
      },
    );
    if (!r.ok) throw new Error(`siteverify ${r.status}`);
    result = await r.json();
  } catch (err) {
    throw new AppError(
      "Failed to verify Turnstile token",
      500,
      ErrorCategory.SYSTEM,
    );
  }

  if (!result.success || !expectedHostnames.has(result.hostname)) {
    throw new AppError(
      "Invalid Turnstile token",
      403,
      ErrorCategory.AUTHENTICATION,
    );
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
