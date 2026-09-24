import { Request, Response } from "express";
import { perfxcelSupabase } from "../db/supabase";
import { AppError, ErrorCategory } from "@dotevolve/error-utils";
import { updateSettingsSchema } from "../validators/schemas";
import { logAuditEvent } from "../utils/auditLogger";

export const getSettings = async (req: Request, res: Response) => {
  const { data, error } = await perfxcelSupabase
    .from("settings")
    .select("setting_key, setting_value");

  if (error) {
    throw new AppError(error.message, 500, ErrorCategory.SYSTEM);
  }

  const settings: Record<string, any> = {};
  for (const row of data) {
    settings[row.setting_key] = row.setting_value;
  }

  res.status(200).json({
    status: "success",
    data: settings,
  });
};

export const updateSettings = async (req: Request, res: Response) => {
  const parsed = updateSettingsSchema.parse(req.body);

  const updates = Object.entries(parsed).filter(([_, val]) => val !== undefined);
  if (updates.length === 0) {
    res.status(400).json({
      status: "fail",
      message: "No settings provided to update",
    });
    return;
  }

  for (const [key, val] of updates) {
    const { error } = await perfxcelSupabase
      .from("settings")
      .upsert({ setting_key: key, setting_value: val, updated_at: new Date().toISOString() });

    if (error) {
      throw new AppError(`Failed to update ${key}: ${error.message}`, 500, ErrorCategory.SYSTEM);
    }
  }

  // Audit log
  await logAuditEvent({
    actorId: (req as any).user?.id || "admin",
    actorEmail: (req as any).user?.email || "admin@example.com",
    action: "update_settings",
    entityType: "settings",
    details: parsed,
  });

  res.status(200).json({
    status: "success",
    message: "Settings updated successfully",
  });
};
