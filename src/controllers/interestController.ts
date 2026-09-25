import { Request, Response } from "express";
import { perfxcelSupabase } from "../db/supabase";
import { NotFoundError, AppError, ErrorCategory } from "@dotevolve/error-utils";
import { logAuditEvent } from "../utils/auditLogger";
import { getSetting } from "../utils/settingsReader";
import { sendBrochureEmail } from "./courseController";

export const getInterests = async (req: Request, res: Response) => {
  const { status, course_id, search, sort, page, limit, date_from, date_to } = req.query;

  let query = perfxcelSupabase
    .from("course_interests")
    .select("*, courses(title)", { count: "exact" })
    .eq("is_hard_deleted", false);

  if (req.query.include_deleted !== "true") {
    query = query.eq("is_deleted", false);
  }

  if (status) {
    const statuses = Array.isArray(status) ? status : [status];
    query = query.in("status", statuses);
  }

  if (course_id) {
    const courseIds = Array.isArray(course_id) ? course_id : [course_id];
    query = query.in("course_id", courseIds);
  }

  if (search) {
    query = query.or(
      `name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,company.ilike.%${search}%`,
    );
  }

  if (date_from) {
    query = query.gte("created_at", String(date_from));
  }

  if (date_to) {
    query = query.lte("created_at", String(date_to));
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

  const { data, error } = await perfxcelSupabase
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

  await logAuditEvent({
    actorType: "user",
    actorId: (req as any).user?.id || "admin",
    actorEmail: (req as any).user?.email || "admin@example.com",
    action: "INTEREST_STATUS_CHANGED",
    entityType: "course_interest",
    entityId: id as string,
    details: { to: status },
  });

  res.status(200).json({
    status: "success",
    data,
  });
};

export const downloadBrochure = async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!token)
    throw new AppError("Token required", 400, ErrorCategory.VALIDATION);

  const { data: interest, error } = await perfxcelSupabase
    .from("course_interests")
    .select("*, courses(brochure_url)")
    .eq("brochure_token", token)
    .single();
  if (error || !interest)
    throw new AppError(
      "Invalid or expired link",
      403,
      ErrorCategory.AUTHENTICATION,
    );

  if (new Date(interest.brochure_expires_at) < new Date()) {
    throw new AppError(
      "This download link has expired. Please request a new one.",
      403,
      ErrorCategory.AUTHENTICATION,
    );
  }

  const brochureUrl = (interest.courses as any)?.brochure_url;
  if (!brochureUrl)
    throw new AppError("Brochure not available", 404, ErrorCategory.NOT_FOUND);

  // Download from storage — brochures are stored in the 'course-brochures' bucket
  const fileName = brochureUrl.split("/").pop();
  const { data: fileData, error: downloadError } =
    await perfxcelSupabase.storage
      .from("course-brochures")
      .download(fileName || brochureUrl);

  if (downloadError || !fileData) {
    throw new AppError(
      "Brochure currently unavailable",
      500,
      ErrorCategory.SYSTEM,
    );
  }

  const arrayBuffer = await fileData.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="Course_Brochure.pdf"',
  );
  res.send(buffer);
};

export const createInterestManual = async (req: Request, res: Response) => {
  const { course_id, name, email, phone, company, send_brochure } = req.body;

  const courseQuery = await perfxcelSupabase
    .from("courses")
    .select("title, brochure_url")
    .eq("id", course_id)
    .single();
  if (courseQuery.error || !courseQuery.data)
    throw new NotFoundError("Course not found");

  let brochureToken = null;
  let brochureExpiresAt = null;

  if (send_brochure && courseQuery.data.brochure_url) {
    brochureToken = crypto.randomUUID();
    const expiryDays = await getSetting<number>("brochure_expiry_days", 180);
    const d = new Date();
    d.setDate(d.getDate() + expiryDays);
    brochureExpiresAt = d.toISOString();
  }

  const { data, error } = await perfxcelSupabase
    .from("course_interests")
    .insert([
      {
        course_id,
        name,
        email,
        phone,
        company,
        brochure_token: brochureToken,
        brochure_expires_at: brochureExpiresAt,
      },
    ])
    .select()
    .single();

  if (error) throw new AppError(error.message, 400, ErrorCategory.VALIDATION);

  await logAuditEvent({
    actorType: "user",
    actorId: (req as any).user?.id || "admin",
    actorEmail: (req as any).user?.email || "admin@example.com",
    action: "FORM_SUBMITTED",
    entityType: "course_interest",
    entityId: data.id,
    details: { name, email, course_id, manual: true },
  });

  if (brochureToken) {
    const downloadUrl = `${process.env.PERFXCEL_API_URL}${process.env.API_VERSION}/interests/brochure/${brochureToken}`;
    await sendBrochureEmail(email, name, courseQuery.data.title, downloadUrl);
    await logAuditEvent({
    actorType: "user",
      actorId: (req as any).user?.id || "admin",
      actorEmail: (req as any).user?.email || "admin@example.com",
      action: "EMAIL_SENT",
      entityType: "course_interest",
      entityId: data.id,
      details: { to: email, type: "brochure", regenerated: false },
    });
  }

  res.status(201).json({ status: "success", data });
};

export const resendBrochure = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { data: interest, error } = await perfxcelSupabase
    .from("course_interests")
    .select("*, courses(title, brochure_url)")
    .eq("id", id)
    .single();

  if (error || !interest) throw new NotFoundError("Interest not found");
  if (!interest.brochure_token || !(interest.courses as any)?.brochure_url) {
    throw new AppError(
      "No brochure associated with this interest",
      400,
      ErrorCategory.VALIDATION,
    );
  }

  let regenerated = false;
  let brochureToken = interest.brochure_token;

  if (new Date(interest.brochure_expires_at) < new Date()) {
    regenerated = true;
    brochureToken = crypto.randomUUID();
    const expiryDays = await getSetting<number>("brochure_expiry_days", 180);
    const d = new Date();
    d.setDate(d.getDate() + expiryDays);
    const { error: updateError } = await perfxcelSupabase
      .from("course_interests")
      .update({
        brochure_token: brochureToken,
        brochure_expires_at: d.toISOString(),
      })
      .eq("id", id);
    if (updateError)
      throw new AppError(
        "Failed to regenerate token",
        500,
        ErrorCategory.SYSTEM,
      );
  }

  const downloadUrl = `${process.env.PERFXCEL_API_URL}${process.env.API_VERSION}/interests/brochure/${brochureToken}`;
  await sendBrochureEmail(
    interest.email,
    interest.name,
    (interest.courses as any).title,
    downloadUrl,
  );

  await logAuditEvent({
    actorType: "user",
    actorId: (req as any).user?.id || "admin",
    actorEmail: (req as any).user?.email || "admin@example.com",
    action: "EMAIL_SENT",
    entityType: "course_interest",
    entityId: id as string,
    details: { to: interest.email, type: "brochure", regenerated },
  });

  res.status(200).json({ status: "success", data: { regenerated } });
};

export const deleteInterests = async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    throw new AppError("Invalid ids", 400, ErrorCategory.VALIDATION);

  const { error } = await perfxcelSupabase
    .from("course_interests")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new AppError(error.message, 500, ErrorCategory.SYSTEM);

  await logAuditEvent({
    actorType: "user",
    actorId: (req as any).user?.id || "admin",
    actorEmail: (req as any).user?.email || "admin@example.com",
    action: "RECORD_DELETED",
    entityType: "course_interest",
    details: { ids, count: ids.length, soft: true },
  });

  res.status(204).send();
};

export const hardDeleteInterest = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { data, error } = await perfxcelSupabase
    .from("course_interests")
    .select("is_hard_deleted")
    .eq("id", id)
    .single();
  if (error || !data) throw new NotFoundError("Interest not found");
  if (data.is_hard_deleted)
    throw new AppError(
      "Record already hard deleted",
      400,
      ErrorCategory.VALIDATION,
    );

  const { error: updateError } = await perfxcelSupabase
    .from("course_interests")
    .update({
      name: "[deleted]",
      email: "[deleted]",
      phone: null,
      company: null,
      is_deleted: true,
      is_hard_deleted: true,
      hard_deleted_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateError)
    throw new AppError(updateError.message, 500, ErrorCategory.SYSTEM);

  await logAuditEvent({
    actorType: "user",
    actorId: (req as any).user?.id || "admin",
    actorEmail: (req as any).user?.email || "admin@example.com",
    action: "GDPR_ERASURE",
    entityType: "course_interest",
    entityId: id as string,
    details: { fields_erased: ["name", "email", "phone", "company"] },
  });

  res.status(204).send();
};
