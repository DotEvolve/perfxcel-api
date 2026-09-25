import { Request, Response } from "express";
import { perfxcelSupabase } from "../db/supabase";
import { AppError, ErrorCategory } from "@dotevolve/error-utils";
import nodemailer from "nodemailer";
import { logAuditEvent } from "../utils/auditLogger";

export const getEnquiries = async (req: Request, res: Response) => {
  const { status, search, page, limit, date_from, date_to } = req.query;

  let query = perfxcelSupabase
    .from("enquiries")
    .select("*, courses(title)", { count: "exact" });

  if (status) {
    query = query.eq("status", status);
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

export const updateEnquiryStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["new", "responded"].includes(status)) {
    throw new AppError("Invalid status", 400, ErrorCategory.VALIDATION);
  }

  const { data, error } = await perfxcelSupabase
    .from("enquiries")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  res.status(200).json({
    status: "success",
    data,
  });
};

export const submitContact = async (req: Request, res: Response) => {
  const { name, email, company, message, course_id, turnstileToken } = req.body;

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

  const { data, error } = await perfxcelSupabase
    .from("enquiries")
    .insert([{ name, email, company, message, course_id }])
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  await logAuditEvent({
    actorType: "user",
    actorId: "system",
    actorEmail: email,
    action: "FORM_SUBMITTED",
    entityType: "enquiries",
    entityId: data.id,
    details: { name, email, course_id },
  });

  // Send email to admin
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
      to:
        process.env.PERFXCEL_ADMIN_EMAIL ||
        process.env.PERFXCEL_CERT_SMTP_USER ||
        "admin@perfxcel.com",
      subject: "New Enquiry Received - Perfxcel",
      text: `You have received a new enquiry:\n\nName: ${name}\nEmail: ${email}\nCompany: ${company || "N/A"}\nMessage: ${message}`,
    });
  } catch (emailErr) {
    console.error("Failed to send admin notification email", emailErr);
    // Don't fail the request if email fails, DB insert was successful
  }

  res.status(201).json({
    status: "success",
    data,
  });
};
