import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import {
  marketingEnquirySchema,
  zodIssuesToFieldErrors,
} from "@medcore/shared";
import { rateLimit } from "../middleware/rate-limit";

export const marketingRouter = Router();

// Anti-spam: 10 enquiries per IP per minute. Public unauthenticated endpoint —
// must be guarded against bot floods even though we have a honeypot + Zod.
// Skipped in tests so the suite can fire dozens of requests without tripping.
const enquiryRateLimit =
  process.env.NODE_ENV === "test"
    ? (_req: Request, _res: Response, next: NextFunction) => next()
    : rateLimit(10, 60_000);

// Schema is defined in @medcore/shared so the browser runs the same rules.
// Issue #45: 400 responses now carry a structured `errors: [{field,message}]`
// list so the form can surface inline errors instead of a generic toast.
const enquirySchema = marketingEnquirySchema;

// POST /api/v1/marketing/enquiry — public, anti-spam honeypot + rate limit,
// optional CRM forward.
marketingRouter.post(
  "/enquiry",
  enquiryRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = enquirySchema.safeParse(req.body);
      if (!parsed.success) {
        // Structured 400 (Issue #45). `error` is preserved for older clients
        // that only read the string, but new clients should consume `errors[]`.
        const errors = zodIssuesToFieldErrors(parsed.error.issues);
        res.status(400).json({
          success: false,
          data: null,
          error: "Please correct the highlighted fields.",
          errors,
        });
        return;
      }
      const data = parsed.data;

      // Honeypot — silently accept to avoid giving bots signal, but don't store.
      if (data.website && data.website.length > 0) {
        res.status(200).json({ success: true, data: { id: null } });
        return;
      }

      const enquiry = await prisma.marketingEnquiry.create({
        data: {
          fullName: data.fullName,
          email: data.email,
          // phone is optional on the public form; DB column is non-null,
          // so we store an empty string when omitted.
          phone: data.phone ?? "",
          hospitalName: data.hospitalName,
          hospitalSize: data.hospitalSize,
          role: data.role,
          message: data.message || null,
          preferredContactTime: data.preferredContactTime || null,
          source: "website",
        },
      });

      // Best-effort CRM forward — CRM outages must NOT block the enquiry.
      const crmUrl = process.env.CRM_WEBHOOK_URL;
      if (crmUrl) {
        try {
          const ctrl = new AbortController();
          const timeout = setTimeout(() => ctrl.abort(), 5000);
          const resp = await fetch(crmUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-medcore-source": "website",
            },
            body: JSON.stringify({
              id: enquiry.id,
              fullName: enquiry.fullName,
              email: enquiry.email,
              phone: enquiry.phone,
              hospitalName: enquiry.hospitalName,
              hospitalSize: enquiry.hospitalSize,
              role: enquiry.role,
              message: enquiry.message,
              preferredContactTime: enquiry.preferredContactTime,
              source: enquiry.source,
              createdAt: enquiry.createdAt,
            }),
            signal: ctrl.signal,
          });
          clearTimeout(timeout);
          if (resp.ok) {
            await prisma.marketingEnquiry.update({
              where: { id: enquiry.id },
              data: { forwardedToCrmAt: new Date() },
            });
          }
        } catch (e) {
          // Swallow — caller sees success, CRM retry is an ops concern.
          console.error("[marketing] CRM forward failed:", e);
        }
      }

      res.status(201).json({ success: true, data: { id: enquiry.id } });
    } catch (err) {
      next(err);
    }
  }
);
