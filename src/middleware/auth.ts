import { Request, Response, NextFunction } from "express";
import { supabase } from "../db/supabase";
import { AuthenticationError } from "@dotevolve/error-utils";

// Evaluated once at module load — avoids repeated process.env reads per request
const supabaseConfigured =
  Boolean(process.env.SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

export const requireAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  // Development bypass — never remove this guard
  if (!supabaseConfigured) {
    console.warn(
      "[requireAuth] Supabase not configured — skipping auth (dev only)",
    );
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthenticationError("Missing or malformed Authorization header");
  }

  const token = authHeader.slice(7); // strip "Bearer "

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new AuthenticationError("Invalid or expired token");
  }

  req.user = data.user;
  next();
};
