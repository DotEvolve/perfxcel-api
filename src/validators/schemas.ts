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
  message: z
    .string()
    .trim()
    .min(10, "Message must be at least 10 characters")
    .max(2000),
  course_id: z.string().optional(),
  turnstileToken: z.string().trim().min(1, "Turnstile token is required"),
});

export const interestSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().trim().toLowerCase().email("Invalid email format"),
  phone: z.string().trim().optional().or(z.literal("")),
  company: z.string().trim().max(150).optional(),
  turnstileToken: z.string().trim().min(1, "Turnstile token is required"),
  request_brochure: z.boolean().optional().default(false),
});

export const interestStatusSchema = z.object({
  status: z.enum(["new", "contacted", "enrolled", "rejected"]),
});

export const courseOutlineSchema = z.array(
  z.object({
    day: z.number().int().positive(),
    title: z.string().trim().min(1),
    modules: z.array(
      z.object({
        title:       z.string().trim().min(1),
        description: z.string().trim().optional(),
        duration:    z.string().trim().optional(),
      })
    ).default([]),
  })
).optional().nullable();

export const updateSettingsSchema = z.object({
  training_plan_expiry_days: z.number().int().min(1).max(3650).optional(),
  brochure_expiry_days: z.number().int().min(1).max(3650).optional(),
});

export const manualInterestSchema = z.object({
  course_id: z.string().uuid(),
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().trim().toLowerCase().email("Invalid email format"),
  phone: z.string().trim().optional().or(z.literal("")),
  company: z.string().trim().max(150).optional(),
  send_brochure: z.boolean().optional().default(false),
});

export const manualTrainingPlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().toLowerCase().email("Invalid email format"),
  mobile: z.string().trim().min(1, "Mobile is required"),
  designation: z.string().trim().optional(),
  company: z.string().trim().optional(),
});

export const courseInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  slug: z.string().trim().optional(),
  short_code: z.string().trim().min(1, "Short code is required"),
  description: z.string().optional(),
  cost: z.number().min(0).optional(),
  status: z.enum(["active", "archived"]).optional(),
  is_public: z.boolean().optional(),
  seo_title: z.string().optional(),
  seo_description: z.string().optional(),
  seo_keywords: z.string().optional(),
  category_ids: z.array(z.string().uuid()).optional(),
  city_ids: z.array(z.string().uuid()).optional(),
  association_ids: z.array(z.string().uuid()).optional(),
  delivery_mode_ids: z.array(z.string().uuid()).optional(),
  schedules: z.array(z.any()).optional(),
  course_outline: courseOutlineSchema.optional().nullable(),
  brochure_url: z.string().url().optional().nullable(),
}).passthrough();
