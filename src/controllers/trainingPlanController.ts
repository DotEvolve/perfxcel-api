import { Request, Response } from "express";
import { perfxcelSupabase } from "../db/supabase";
import { AppError, ErrorCategory, NotFoundError } from "@dotevolve/error-utils";
import nodemailer from "nodemailer";
import { getSetting } from "../utils/settingsReader";
import { logAuditEvent } from "../utils/auditLogger";

export const requestTrainingPlan = async (req: Request, res: Response) => {
  const { name, email, mobile, designation, company, turnstileToken } =
    req.body;

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

  if (
    !result.success ||
    (expectedHostnames.size > 0 && !expectedHostnames.has(result.hostname))
  ) {
    throw new AppError(
      "Invalid Turnstile token",
      403,
      ErrorCategory.AUTHENTICATION,
    );
  }

  // Calculate dynamic expiry
  const expiryDays = await getSetting<number>("training_plan_expiry_days", 180);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiryDays);

  // Insert into DB using admin client or service role to bypass RLS for public insert
  const { data, error } = await perfxcelSupabase
    .from("training_plan_requests")
    .insert([
      {
        name,
        email,
        mobile,
        designation,
        company,
        expires_at: expiresAt.toISOString(),
      },
    ])
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 500, ErrorCategory.SYSTEM);
  }

  // The generated token is data.token
  // Usually API URL is the base for the backend, e.g. https://api-dev.perfxcel.com/api/v1
  const downloadLink = `${process.env.PERFXCEL_API_URL}${process.env.API_VERSION}/training-plan/download/${data.token}`;

  // Send email to user
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.PERFXCEL_CERT_SMTP_HOST || "localhost",
      port: parseInt(process.env.PERFXCEL_CERT_SMTP_PORT || "587", 10),
      secure: process.env.PERFXCEL_CERT_SMTP_PORT === "465",
      auth: {
        user: process.env.PERFXCEL_CERT_SMTP_USER,
        pass: process.env.PERFXCEL_CERT_SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from:
        process.env.PERFXCEL_CERT_SMTP_FROM ||
        "Perfxcel <no-reply@perfxcel.com>",
      to: email,
      subject: "Your PerfXcel Enterprise Training Plan",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #0f172a;">Hello ${name},</h2>
          <p>Thank you for your interest in the PerfXcel Enterprise Training Plan.</p>
          <p>You can download your customized training plan PDF using the secure link below. Please note that this link is uniquely generated for you and will expire in ${expiryDays} days.</p>
          <div style="margin: 30px 0;">
            <a href="${downloadLink}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Download Training Plan</a>
          </div>
          <p>If the button above does not work, you can copy and paste the following URL into your browser:</p>
          <p style="word-break: break-all; color: #64748b;">${downloadLink}</p>
          <p style="margin-top: 40px;">Best regards,<br/><strong>The PerfXcel Team</strong></p>
        </div>
      `,
    });
  } catch (emailErr) {
    console.error("Failed to send training plan email", emailErr);
  }

  await logAuditEvent({
    actorType: "user",
    actorId: "system",
    actorEmail: email,
    action: "FORM_SUBMITTED",
    entityType: "training_plan_requests",
    entityId: data.id,
    details: { name, company, email },
  });

  res.status(201).json({
    status: "success",
    message: "Training plan requested successfully",
  });
};

export const downloadTrainingPlan = async (req: Request, res: Response) => {
  const { token } = req.params;

  if (!token) {
    throw new AppError("Token is required", 400, ErrorCategory.VALIDATION);
  }

  // Find the token
  const { data: request, error: findError } = await perfxcelSupabase
    .from("training_plan_requests")
    .select("*")
    .eq("token", token)
    .single();

  if (findError || !request) {
    throw new AppError(
      "Invalid or expired download link",
      403,
      ErrorCategory.AUTHENTICATION,
    );
  }

  // Check expiration
  if (new Date(request.expires_at) < new Date()) {
    throw new AppError(
      "This download link has expired. Please request a new one.",
      403,
      ErrorCategory.AUTHENTICATION,
    );
  }

  // Generate a short-lived signed URL or download the file directly and stream it.
  const { data: fileData, error: downloadError } =
    await perfxcelSupabase.storage.from("assets").download("training_plan.pdf");

  if (downloadError || !fileData) {
    console.error("Failed to download PDF from storage", downloadError);
    throw new AppError(
      "The training plan document is currently unavailable.",
      500,
      ErrorCategory.SYSTEM,
    );
  }

  // Convert Blob to Buffer and stream to response
  const arrayBuffer = await fileData.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="Perfxcel_Training_Plan.pdf"',
  );
  res.send(buffer);
};

export const getTrainingPlanRequests = async (req: Request, res: Response) => {
  const { search, page, limit, date_from, date_to } = req.query;

  let query = perfxcelSupabase
    .from("training_plan_requests")
    .select("*", { count: "exact" })
    .eq("is_hard_deleted", false);

  if (req.query.include_deleted !== "true") {
    query = query.eq("is_deleted", false);
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  if (date_from) {
    query = query.gte("created_at", String(date_from));
  }

  if (date_to) {
    query = query.lte("created_at", String(date_to));
  }

  query = query.order("created_at", { ascending: false });

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

export const createTrainingPlanManual = async (req: Request, res: Response) => {
  const { name, email, mobile, designation, company } = req.body;

  const expiryDays = await getSetting<number>("training_plan_expiry_days", 180);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiryDays);

  const { data, error } = await perfxcelSupabase
    .from("training_plan_requests")
    .insert([
      {
        name,
        email,
        mobile,
        designation,
        company,
        expires_at: expiresAt.toISOString(),
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
    entityType: "training_plan_requests",
    entityId: data.id,
    details: { name, email, company, manual: true },
  });

  const downloadLink = `${process.env.PERFXCEL_API_URL}${process.env.API_VERSION}/training-plan/download/${data.token}`;
  // Send email (same logic as requestTrainingPlan, omitted full copy block for brevity here but it would go here)
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.PERFXCEL_CERT_SMTP_HOST || "localhost",
      port: parseInt(process.env.PERFXCEL_CERT_SMTP_PORT || "587", 10),
      secure: process.env.PERFXCEL_CERT_SMTP_PORT === "465",
      auth: {
        user: process.env.PERFXCEL_CERT_SMTP_USER,
        pass: process.env.PERFXCEL_CERT_SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from:
        process.env.PERFXCEL_CERT_SMTP_FROM ||
        "Perfxcel <no-reply@perfxcel.com>",
      to: email,
      subject: "Your PerfXcel Enterprise Training Plan",
      html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #0f172a;">Hello ${name},</h2>
          <p>Thank you for your interest in the PerfXcel Enterprise Training Plan.</p>
          <p>You can download your customized training plan PDF using the secure link below. Please note that this link is uniquely generated for you and will expire in ${expiryDays} days.</p>
          <div style="margin: 30px 0;">
            <a href="${downloadLink}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Download Training Plan</a>
          </div>
        </div>`,
    });
  } catch (emailErr) {
    console.error("Failed to send training plan email", emailErr);
  }

  await logAuditEvent({
    actorType: "user",
    actorId: (req as any).user?.id || "admin",
    actorEmail: (req as any).user?.email || "admin@example.com",
    action: "EMAIL_SENT",
    entityType: "training_plan_requests",
    entityId: data.id,
    details: { to: email, type: "training_plan", regenerated: false },
  });

  res.status(201).json({ status: "success", data });
};

export const resendTrainingPlan = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { data: request, error } = await perfxcelSupabase
    .from("training_plan_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !request) throw new NotFoundError("Request not found");

  let regenerated = false;
  let token = request.token;
  let expiryDays = await getSetting<number>("training_plan_expiry_days", 180);

  if (new Date(request.expires_at) < new Date()) {
    regenerated = true;
    token = crypto.randomUUID();
    const d = new Date();
    d.setDate(d.getDate() + expiryDays);
    const { error: updateError } = await perfxcelSupabase
      .from("training_plan_requests")
      .update({
        token,
        expires_at: d.toISOString(),
      })
      .eq("id", id);
    if (updateError)
      throw new AppError(
        "Failed to regenerate token",
        500,
        ErrorCategory.SYSTEM,
      );
  }

  const downloadLink = `${process.env.PERFXCEL_API_URL}${process.env.API_VERSION}/training-plan/download/${token}`;

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.PERFXCEL_CERT_SMTP_HOST || "localhost",
      port: parseInt(process.env.PERFXCEL_CERT_SMTP_PORT || "587", 10),
      secure: process.env.PERFXCEL_CERT_SMTP_PORT === "465",
      auth: {
        user: process.env.PERFXCEL_CERT_SMTP_USER,
        pass: process.env.PERFXCEL_CERT_SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from:
        process.env.PERFXCEL_CERT_SMTP_FROM ||
        "Perfxcel <no-reply@perfxcel.com>",
      to: request.email,
      subject: "Your PerfXcel Enterprise Training Plan",
      html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #0f172a;">Hello ${request.name},</h2>
          <p>Thank you for your interest in the PerfXcel Enterprise Training Plan.</p>
          <p>You can download your customized training plan PDF using the secure link below. Please note that this link is uniquely generated for you and will expire in ${expiryDays} days.</p>
          <div style="margin: 30px 0;">
            <a href="${downloadLink}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Download Training Plan</a>
          </div>
        </div>`,
    });
  } catch (emailErr) {
    console.error("Failed to send training plan email", emailErr);
  }

  await logAuditEvent({
    actorType: "user",
    actorId: (req as any).user?.id || "admin",
    actorEmail: (req as any).user?.email || "admin@example.com",
    action: "EMAIL_SENT",
    entityType: "training_plan_requests",
    entityId: id as string,
    details: { to: request.email, type: "training_plan", regenerated },
  });

  res.status(200).json({ status: "success", data: { regenerated } });
};

export const deleteTrainingPlans = async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    throw new AppError("Invalid ids", 400, ErrorCategory.VALIDATION);

  const { error } = await perfxcelSupabase
    .from("training_plan_requests")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new AppError(error.message, 500, ErrorCategory.SYSTEM);

  await logAuditEvent({
    actorType: "user",
    actorId: (req as any).user?.id || "admin",
    actorEmail: (req as any).user?.email || "admin@example.com",
    action: "RECORD_DELETED",
    entityType: "training_plan_requests",
    details: { ids, count: ids.length, soft: true },
  });

  res.status(204).send();
};

export const hardDeleteTrainingPlan = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { data, error } = await perfxcelSupabase
    .from("training_plan_requests")
    .select("is_hard_deleted")
    .eq("id", id)
    .single();
  if (error || !data) throw new NotFoundError("Request not found");
  if (data.is_hard_deleted)
    throw new AppError(
      "Record already hard deleted",
      400,
      ErrorCategory.VALIDATION,
    );

  const { error: updateError } = await perfxcelSupabase
    .from("training_plan_requests")
    .update({
      name: "[deleted]",
      email: "[deleted]",
      mobile: null,
      designation: null,
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
    entityType: "training_plan_requests",
    entityId: id as string,
    details: {
      fields_erased: ["name", "email", "mobile", "designation", "company"],
    },
  });

  res.status(204).send();
};
