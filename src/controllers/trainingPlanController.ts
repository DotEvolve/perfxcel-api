import { Request, Response } from "express";
import { supabase } from "../db/supabase";
import { AppError, ErrorCategory } from "@dotevolve/error-utils";
import nodemailer from "nodemailer";

export const requestTrainingPlan = async (req: Request, res: Response) => {
  const { name, email, mobile, designation, company, turnstileToken } = req.body;

  const expectedHostnames = new Set(
    (process.env.VITE_PERFXCEL_TURNSTILE_HOSTNAMES ?? "dev.perfxcel.com,perfxcel.com")
      .split(",")
      .map((hostname) => hostname.trim())
      .filter(Boolean)
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

  if (!result.success || (expectedHostnames.size > 0 && !expectedHostnames.has(result.hostname))) {
    throw new AppError("Invalid Turnstile token", 403, ErrorCategory.AUTHENTICATION);
  }

  // Insert into DB using admin client or service role to bypass RLS for public insert
  const { data, error } = await supabase
    .from("training_plan_requests")
    .insert([{ name, email, mobile, designation, company }])
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 500, ErrorCategory.SYSTEM);
  }

  // The generated token is data.token
  // Usually API URL is the base for the backend, e.g. https://api-dev.perfxcel.com/api/v1
  const downloadLink = `${process.env.VITE_API_URL || "https://api-dev.perfxcel.com/api/v1"}/training-plan/download/${data.token}`;

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
      from: process.env.PERFXCEL_CERT_SMTP_FROM || "Perfxcel <no-reply@perfxcel.com>",
      to: email,
      subject: "Your PerfXcel Enterprise Training Plan",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #0f172a;">Hello ${name},</h2>
          <p>Thank you for your interest in the PerfXcel Enterprise Training Plan.</p>
          <p>You can download your customized training plan PDF using the secure link below. Please note that this link is uniquely generated for you and will expire in exactly 72 hours.</p>
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
  const { data: request, error: findError } = await supabase
    .from("training_plan_requests")
    .select("*")
    .eq("token", token)
    .single();

  if (findError || !request) {
    throw new AppError("Invalid or expired download link", 403, ErrorCategory.AUTHENTICATION);
  }

  // Check expiration
  if (new Date(request.expires_at) < new Date()) {
    throw new AppError("This download link has expired. Please request a new one.", 403, ErrorCategory.AUTHENTICATION);
  }

  // Generate a short-lived signed URL or download the file directly and stream it.
  const { data: fileData, error: downloadError } = await supabase.storage
    .from("assets")
    .download("training_plan.pdf");

  if (downloadError || !fileData) {
    console.error("Failed to download PDF from storage", downloadError);
    throw new AppError("The training plan document is currently unavailable.", 500, ErrorCategory.SYSTEM);
  }

  // Convert Blob to Buffer and stream to response
  const arrayBuffer = await fileData.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="Perfxcel_Training_Plan.pdf"');
  res.send(buffer);
};

export const getTrainingPlanRequests = async (req: Request, res: Response) => {
  const { search, page, limit } = req.query;

  let query = supabase
    .from("training_plan_requests")
    .select("*", { count: "exact" });

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
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
