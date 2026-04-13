import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@medcore/shared";

export interface AuthPayload {
  userId: string;
  email: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ success: false, data: null, error: "Unauthorized" });
    return;
  }

  const token = header.split(" ")[1];
  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET || "dev-secret"
    ) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ success: false, data: null, error: "Invalid or expired token" });
  }
}

export function authorize(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, data: null, error: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.user.role as Role)) {
      res.status(403).json({ success: false, data: null, error: "Forbidden" });
      return;
    }
    next();
  };
}
