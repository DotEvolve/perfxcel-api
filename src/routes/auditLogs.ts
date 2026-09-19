import { Router, Request, Response } from "express";
import { asyncHandler, AppError, ErrorCategory } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { requirePerfxcelTenant } from "../middleware/tenant";

const router = Router();

const portalUrl = process.env.PORTAL_API_URL;

router.post(
  "/",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(async (req: Request, res: Response) => {
    if (!portalUrl) {
      throw new AppError(
        "Audit log service is not configured",
        502,
        ErrorCategory.SYSTEM,
      );
    }

    try {
      const response = await fetch(`${portalUrl}/api/v1/audit-logs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: req.headers.authorization || "",
          "x-tenant-id": req.tenantId || "",
        },
        body: JSON.stringify(req.body),
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      res.status(200).json(data);
    } catch (error) {
      throw new AppError(
        "Failed to communicate with audit log service",
        502,
        ErrorCategory.SYSTEM,
      );
    }
  }),
);

router.get(
  "/",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(async (req: Request, res: Response) => {
    if (!portalUrl) {
      throw new AppError(
        "Audit log service is not configured",
        502,
        ErrorCategory.SYSTEM,
      );
    }

    try {
      const queryString = new URLSearchParams(req.query as any).toString();
      const url = `${portalUrl}/api/v1/audit-logs${queryString ? `?${queryString}` : ""}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: req.headers.authorization || "",
          "x-tenant-id": req.tenantId || "",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      res.status(200).json(data);
    } catch (error) {
      throw new AppError(
        "Failed to communicate with audit log service",
        502,
        ErrorCategory.SYSTEM,
      );
    }
  }),
);

export default router;
