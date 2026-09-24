import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import {
  AuthenticationError,
  AuthorizationError,
} from "@dotevolve/error-utils";

import { publicSupabase } from "../db/supabase";

const supabaseConfigured =
  Boolean(process.env.SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

export const requirePerfxcelTenant = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!supabaseConfigured) {
    console.warn(
      "[requirePerfxcelTenant] Supabase not configured — tenant checks may fail if DB is required",
    );
  }

  if (!req.user) {
    return next(new AuthenticationError("Not authenticated"));
  }

  try {
    const { data: tenant, error: tenantError } = await publicSupabase
      .from("tenants")
      .select("id")
      .eq("slug", "perfxcel")
      .single();

    if (tenantError || !tenant) {
      return next(new AuthorizationError("PerfXcel tenant not found"));
    }

    const { data: membership, error: membershipError } = await publicSupabase
      .from("user_tenant_roles")
      .select("tenant_id")
      .eq("user_id", req.user.id)
      .eq("tenant_id", tenant.id)
      .single();

    if (membershipError || !membership) {
      return next(
        new AuthorizationError("Access restricted to PerfXcel tenant users"),
      );
    }

    req.tenantId = tenant.id;
    next();
  } catch (error) {
    return next(new AuthorizationError("Error verifying tenant access"));
  }
};
