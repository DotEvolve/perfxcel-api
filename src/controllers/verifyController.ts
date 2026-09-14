import { Request, Response } from "express";
import { supabase } from "../db/supabase";
import { AppError, ErrorCategory } from "@dotevolve/error-utils";

export const verifyCertificate = async (req: Request, res: Response) => {
  const { credential_id, turnstileToken } = req.body;

  if (!turnstileToken) {
    throw new AppError("Missing turnstile token", 400, ErrorCategory.VALIDATION);
  }

  // Validate turnstile token
  const formData = new URLSearchParams();
  formData.append('secret', process.env.VITE_PERFXCEL_TURNSTILE_SECRET_KEY || '');
  formData.append('response', turnstileToken);

  const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: formData,
  });

  const turnstileData = await turnstileRes.json();
  if (!turnstileData.success) {
    throw new AppError("Turnstile verification failed", 403, ErrorCategory.AUTHENTICATION);
  }

  const hostnames = (process.env.VITE_PERFXCEL_TURNSTILE_HOSTNAMES || '').split(',').map(h => h.trim());
  if (hostnames.length > 0 && !hostnames.includes(turnstileData.hostname)) {
      throw new AppError("Turnstile hostname mismatch", 403, ErrorCategory.AUTHENTICATION);
  }

  const { data, error } = await supabase
    .from("certificates")
    .select("credential_id, issued_at, pdf_url, enrollments(id, course_interests(name, courses(title)))")
    .eq("credential_id", credential_id)
    .maybeSingle();

  if (error) {
    throw new AppError(error.message, 500, ErrorCategory.SYSTEM);
  }

  if (!data) {
    return res.status(200).json({
      status: "success",
      data: { valid: false }
    });
  }

  // Supabase returns nested joins as objects, or arrays of objects. 
  // For standard joins where it's 1-to-1, it's an object.
  const enrollments: any = data.enrollments;
  
  return res.status(200).json({
    status: "success",
    data: {
      valid: true,
      candidate_name: enrollments?.course_interests?.name,
      course_title: enrollments?.course_interests?.courses?.title,
      issued_at: data.issued_at,
      credential_id: data.credential_id,
      pdf_url: data.pdf_url
    }
  });
};
