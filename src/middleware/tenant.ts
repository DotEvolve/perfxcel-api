import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import { AuthenticationError, AuthorizationError } from "@dotevolve/error-utils";

// A separate client targeting the `public` schema (no perfxcel schema override)
const portalSupabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const supabaseConfigured =
  Boolean(process.env.SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

export const requirePerfxcelTenant = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  // Development bypass
  if (!supabaseConfigured) {
    console.warn(
      "[requirePerfxcelTenant] Supabase not configured — bypassing tenant check (dev only)"
    );
    req.tenantId = "dev-perfxcel-tenant";
    return next();
  }

  if (!req.user) {
    return next(new AuthenticationError("Not authenticated"));
  }

  try {
    const { data: tenant, error: tenantError } = await portalSupabase
      .from("tenants")
      .select("id")
      .eq("slug", "perfxcel")
      .single();

    if (tenantError || !tenant) {
      return next(new AuthorizationError("PerfXcel tenant not found"));
    }

    const { data: membership, error: membershipError } = await portalSupabase
      .from("user_tenant_roles")
      .select("tenant_id")
      .eq("user_id", req.user.id)
      .eq("tenant_id", tenant.id)
      .single();

    if (membershipError || !membership) {
      return next(new AuthorizationError("Access restricted to PerfXcel tenant users"));
    }

    req.tenantId = tenant.id;
    next();
  } catch (error) {
    return next(new AuthorizationError("Error verifying tenant access"));
  }
};
