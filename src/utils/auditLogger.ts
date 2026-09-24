import { publicSupabase } from "../db/supabase";
import { logger } from "@dotevolve/core/logger";

interface AuditEventParams {
  tenantId?: string;
  actorId: string; // req.user?.id or "system" for public routes
  actorEmail?: string; // req.user?.email or submitter's email
  actorType: "user" | "service";
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

let cachedPerfxcelTenantId: string | null = null;

export async function logAuditEvent(params: AuditEventParams): Promise<void> {
  const portalUrl = process.env.PORTAL_API_URL;
  if (!portalUrl) return;

  try {
    let tenantId = params.tenantId;
    if (!tenantId) {
      if (!cachedPerfxcelTenantId) {
        const { data } = await publicSupabase
          .from("tenants")
          .select("id")
          .eq("slug", "perfxcel")
          .single();
        if (data) {
          cachedPerfxcelTenantId = data.id;
        }
      }
      tenantId = cachedPerfxcelTenantId || undefined;
    }

    if (!tenantId) {
      // Cannot log without tenant ID
      return;
    }

    await fetch(`${portalUrl}/api/v1/audit-logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
      body: JSON.stringify({
        events: [
          {
            action: params.action,
            entityType: params.entityType,
            entityId: params.entityId,
            actorId: params.actorId,
            actorType: params.actorType,
            actorEmail: params.actorEmail,
            tenantId: tenantId,
            details: params.details ?? {},
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch (error) {
    logger.warn(
      "Audit logger failed, swallowing error to prevent flow disruption",
      { error },
    );
  }
}
