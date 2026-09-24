import { Request, Response, NextFunction } from "express";
import { AuthenticationError, AuthorizationError } from "@dotevolve/error-utils";
import { publicSupabase } from "../db/supabase";

const supabaseConfigured =
  Boolean(process.env.SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Verifies that the authenticated user has an active role for the 'perfxcel'
 * app specifically, using the platform's own user_tenant_roles table.
 *
 * The query checks (user_id, tenant_id, app_slug = 'perfxcel', status = 'active'),
 * which is exactly how the portal enforces app-level isolation across all tenants.
 * This means:
 *   - Users in other tenants but not assigned to perfxcel are blocked.
 *   - Users in the perfxcel tenant but assigned to a different app_slug are blocked.
 *   - Only users with an explicit perfxcel app role are allowed.
 *
 * This check is consistent with how govnix-api and floorix-api would enforce their
 * own app access — no manual workaround needed in perfxcel-admin.
 */
export const requirePerfxcelTenant = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  // Development bypass — never remove this guard
  if (!supabaseConfigured) {
    console.warn(
      "[requirePerfxcelTenant] Supabase not configured — skipping tenant check (dev only)",
    );
    return next();
  }

  if (!req.user) {
    return next(new AuthenticationError("Not authenticated"));
  }

  try {
    // 1. Look up the perfxcel tenant ID (cached at module scope after first call)
    const { data: tenant, error: tenantError } = await publicSupabase
      .from("tenants")
      .select("id")
      .eq("slug", "perfxcel")
      .single();

    if (tenantError || !tenant) {
      return next(new AuthorizationError("PerfXcel tenant not found"));
    }

    // 2. Verify the user has an *active* role for the 'perfxcel' app_slug specifically.
    //    This is the same data model check that drives portal app-card visibility and
    //    SSO access. A row must exist for (user_id, tenant_id, app_slug='perfxcel', status='active').
    const { data: membership, error: membershipError } = await publicSupabase
      .from("user_tenant_roles")
      .select("tenant_id, role")
      .eq("user_id", req.user.id)
      .eq("tenant_id", tenant.id)
      .eq("app_slug", "perfxcel")
      .eq("status", "active")
      .maybeSingle();

    if (membershipError) {
      return next(new AuthorizationError("Error verifying app access"));
    }

    if (!membership) {
      return next(
        new AuthorizationError(
          "Access restricted. You are not assigned to the PerfXcel app.",
        ),
      );
    }

    req.tenantId = tenant.id;
    next();
  } catch (error) {
    return next(new AuthorizationError("Error verifying tenant access"));
  }
};
