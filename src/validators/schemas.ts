import { z } from "zod";

export const trainingPlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().toLowerCase().email("Invalid email format"),
  mobile: z.string().trim().min(1, "Mobile is required"),
  designation: z.string().trim().optional(),
  company: z.string().trim().optional(),
  turnstileToken: z.string().trim().min(1, "Turnstile token is required"),
});
