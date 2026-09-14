import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../db/supabase";
import { AppError, ErrorCategory, ConflictError, NotFoundError } from "@dotevolve/error-utils";
import QRCode from "qrcode";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";

export const getEnrollments = async (req: Request, res: Response) => {
  const { status, search, sort, page, limit } = req.query;

  let query = supabase
    .from("enrollments")
    .select("*, course_interests!inner(name, email, courses(title))", { count: "exact" });

  if (status) {
    const statuses = Array.isArray(status) ? status : [status];
    query = query.in("status", statuses);
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`, { foreignTable: "course_interests" });
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

export const createEnrollment = async (req: Request, res: Response) => {
  const { interest_id } = req.body;

  if (!interest_id) {
    throw new AppError("interest_id is required", 400, ErrorCategory.VALIDATION);
  }

  // Verify interest exists
  const { data: interest, error: interestError } = await supabase
    .from("course_interests")
    .select("id")
    .eq("id", interest_id)
    .single();

  if (interestError || !interest) {
    throw new NotFoundError("Interest not found");
  }

  // Check for duplicate enrollment
  const { data: existing, error: existingError } = await supabase
    .from("enrollments")
    .select("id")
    .eq("interest_id", interest_id)
    .maybeSingle();

  if (existingError) {
    throw new AppError(existingError.message, 500, ErrorCategory.SYSTEM);
  }

  if (existing) {
    throw new ConflictError("Enrollment already exists for this interest");
  }

  const { data, error } = await supabase
    .from("enrollments")
    .insert({ interest_id })
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 500, ErrorCategory.SYSTEM);
  }

  res.status(201).json({
    status: "success",
    data,
  });
};

export const updateEnrollmentStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ["pending", "in_progress", "achieved", "dropped"];
  if (!validStatuses.includes(status)) {
    throw new AppError("Invalid status value", 400, ErrorCategory.VALIDATION);
  }

  const { data: enrollment, error: updateError } = await supabase
    .from("enrollments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*, course_interests(name, email, courses(title))")
    .single();

  if (updateError) {
    throw new AppError(updateError.message, 500, ErrorCategory.SYSTEM);
  }

  if (!enrollment) {
    throw new NotFoundError("Enrollment not found");
  }

  if (status === "achieved") {
    // Check if certificate exists
    const { data: certData } = await supabase
      .from("certificates")
      .select("id")
      .eq("enrollment_id", id)
      .maybeSingle();

    if (!certData) {
      await generateAndIssueCertificate(enrollment, enrollment.course_interests);
    }
  }

  res.status(200).json({
    status: "success",
    data: enrollment,
  });
};

async function generateUniqueCredentialId(): Promise<string> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let attempt = 0; attempt < 5; attempt++) {
    let credentialId = "";
    for (let i = 0; i < 8; i++) {
      credentialId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const { data } = await supabase
      .from("certificates")
      .select("id")
      .eq("credential_id", credentialId)
      .maybeSingle();
      
    if (!data) {
      return credentialId;
    }
  }
  throw new AppError("Failed to generate unique credential ID", 500, ErrorCategory.SYSTEM);
}

async function generateAndIssueCertificate(enrollment: any, interest: any) {
  // 1. Generate unique credential_id
  const credentialId = await generateUniqueCredentialId();

  // 2. Generate QR code as PNG buffer
  const verifyUrl = `https://perfxcel.com/verify?id=${credentialId}`;
  const qrBuffer = await QRCode.toBuffer(verifyUrl, { width: 150, margin: 1 });

  // 3. Load certificate template + overlay dynamic content with pdf-lib
  const templatePath = path.join(__dirname, "../../assets/certificate_template.png");
  if (!fs.existsSync(templatePath)) {
    throw new AppError("Certificate template not found", 500, ErrorCategory.SYSTEM);
  }
  const templateBytes = fs.readFileSync(templatePath);
  
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([1200, 850]); 
  
  const pngImage = await pdfDoc.embedPng(templateBytes);
  page.drawImage(pngImage, { x: 0, y: 0, width: 1200, height: 850 });

  // Embed QR code
  const qrImage = await pdfDoc.embedPng(qrBuffer);
  page.drawImage(qrImage, { x: 950, y: 100, width: 150, height: 150 });

  // Overlay text
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  page.drawText(interest.name, { x: 600 - (interest.name.length * 12), y: 450, size: 48, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(interest.courses.title, { x: 600 - (interest.courses.title.length * 5), y: 380, size: 24, font, color: rgb(0.3, 0.3, 0.3) });
  page.drawText(formatDate(new Date()), { x: 600 - 45, y: 330, size: 18, font });
  page.drawText(`Credential ID: ${credentialId}`, { x: 600 - 75, y: 280, size: 16, font, color: rgb(0.4, 0.4, 0.4) });

  const pdfBytes = await pdfDoc.save();

  // 4. Upload to Supabase Storage
  const storageClient = createClient(process.env.SUPABASE_URL || "", process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  const { data: uploadData, error: uploadError } = await storageClient.storage
    .from("certificates")
    .upload(`${credentialId}.pdf`, Buffer.from(pdfBytes), { contentType: "application/pdf", upsert: false });
    
  if (uploadError) {
    throw new AppError(`Storage error: ${uploadError.message}`, 500, ErrorCategory.SYSTEM);
  }

  const { data: { publicUrl } } = storageClient.storage.from("certificates").getPublicUrl(`${credentialId}.pdf`);

  // 5. Insert certificate record
  const { error: certError } = await supabase.from("certificates").insert({
    credential_id: credentialId,
    enrollment_id: enrollment.id,
    pdf_url: publicUrl,
  });
  
  if (certError) {
    throw new AppError(`Cert insert error: ${certError.message}`, 500, ErrorCategory.SYSTEM);
  }

  // 6. Send email
  await sendCertificateEmail(interest.email, interest.name, publicUrl, Buffer.from(pdfBytes), credentialId);
}

async function sendCertificateEmail(to: string, name: string, pdfUrl: string, pdfBuffer: Buffer, credentialId: string) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "localhost",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailOptions = {
    from: process.env.SMTP_FROM || "Perfxcel <no-reply@perfxcel.com>",
    to,
    subject: "Your Perfxcel Certificate is Ready",
    html: `
      <p>Dear ${name},</p>
      <p>Congratulations on achieving your certification!</p>
      <p>Your official Perfxcel certificate is attached to this email. You can also view and download it at any time using the link below:</p>
      <p><a href="${pdfUrl}">${pdfUrl}</a></p>
      <p>Your Credential ID is: <strong>${credentialId}</strong></p>
      <br/>
      <p>Best regards,<br/>The Perfxcel Team</p>
    `,
    attachments: [
      {
        filename: 'certificate.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  };

  try {
    // If no real SMTP config is provided, we just log and skip instead of failing
    if (process.env.SMTP_HOST) {
      await transporter.sendMail(mailOptions);
    } else {
      console.log(`[Email Mock] Sent certificate to ${to} for credential ${credentialId}`);
    }
  } catch (error) {
    console.error("Failed to send email:", error);
    // Don't fail the whole request just because email failed
  }
}
