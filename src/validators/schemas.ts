import { z } from "zod";

export const trainingPlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().toLowerCase().email("Invalid email format"),
  mobile: z.string().trim().min(1, "Mobile is required"),
  designation: z.string().trim().optional(),
  company: z.string().trim().optional(),
  turnstileToken: z.string().trim().min(1, "Turnstile token is required"),
});

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().trim().toLowerCase().email("Invalid email format"),
  company: z.string().trim().max(150).optional(),
  message: z.string().trim().min(10, "Message must be at least 10 characters").max(2000),
  course_id: z.string().optional(),
  turnstileToken: z.string().trim().min(1, "Turnstile token is required"),
});

export const interestSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().trim().toLowerCase().email("Invalid email format"),
  phone: z.string().trim().optional().or(z.literal("")),
  company: z.string().trim().max(150).optional(),
  turnstileToken: z.string().trim().min(1, "Turnstile token is required"),
});

export const interestStatusSchema = z.object({
  status: z.enum(["new", "contacted", "enrolled", "rejected"]),
});
