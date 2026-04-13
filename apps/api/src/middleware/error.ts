import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error("Error:", err);

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      data: null,
      error: "Validation failed",
      details: err.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
    return;
  }

  res.status(500).json({
    success: false,
    data: null,
    error: process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message,
  });
}
