import { Request, Response, NextFunction } from "express";
import { ZodTypeAny, ZodError } from "zod";
import { AppError, ErrorCategory } from "@dotevolve/error-utils";

export const validateBody = (schema: ZodTypeAny) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedBody = await schema.parseAsync(req.body);
      req.body = parsedBody;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Zod 4.x compatibility: issues array
        const errorMessages = error.issues.map((issue: any) => ({
          message: `${issue.path.join(".")} is ${issue.message}`,
        }));
        // Provide a joined string of validation errors
        next(
          new AppError(
            `Validation failed: ${errorMessages.map((e: any) => e.message).join(", ")}`,
            400,
            ErrorCategory.VALIDATION,
          ),
        );
      } else {
        next(
          new AppError("Invalid request data", 400, ErrorCategory.VALIDATION),
        );
      }
    }
  };
};
