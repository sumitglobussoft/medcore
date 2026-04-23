/**
 * HL7 v2 export endpoints — produces pipe-delimited HL7 v2.5.1 messages for
 * legacy Indian lab and HIS systems that don't speak FHIR.
 *
 * Every endpoint is ADMIN-only and every export is audit-logged because HL7
 * messages carry the same PHI scope as the FHIR exports. The Content-Type is
 * `application/hl7-v2` — the IANA-registered MIME for HL7 v2; callers that
 * prefer `text/plain` should negotiate client-side.
 *
 * Line endings: responses contain ONLY `\r` segment terminators. We do NOT
 * translate to `\r\n` — per HL7 v2 §2.3 the segment terminator is a single
 * CR and legacy parsers break if LF is added.
 */

import { Router, Request, Response, NextFunction } from "express";
// Multi-tenant wiring: `tenantScopedPrisma` is a Prisma $extends wrapper that
// auto-injects tenantId on create and auto-filters on read for the 20
// tenant-scoped models (see services/tenant-prisma.ts). We alias it to
// `prisma` so every existing call site keeps working without edits.
import { tenantScopedPrisma as prisma } from "../services/tenant-prisma";
import { Role } from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { auditLog } from "../middleware/audit";
import {
  buildADT_A04,
  buildORM_O01,
  buildORU_R01,
  type HL7Patient,
  type HL7LabOrder,
  type HL7LabResult,
  type HL7Admission,
} from "../services/hl7v2/messages";

const router = Router();
router.use(authenticate);

const HL7_CONTENT_TYPE = "application/hl7-v2";

/** Send an HL7 v2 response with the correct Content-Type. */
function sendHl7(res: Response, status: number, body: string) {
  res.status(status).type(HL7_CONTENT_TYPE).send(body);
}

/** Send a simple plaintext error response (HL7 v2 has no native error envelope). */
function sendError(res: Response, status: number, message: string) {
  res.status(status).type("text/plain").send(message);
}

// ─── GET /api/v1/hl7v2/patient/:id — ADT^A04 ─────────────────────────────────

router.get(
  "/patient/:id",
  authorize(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const patient = await prisma.patient.findUnique({
        where: { id },
        include: { user: true, admissions: { orderBy: { admittedAt: "desc" }, take: 1 } },
      });
      if (!patient) {
        sendError(res, 404, `Patient ${id} not found`);
        return;
      }

      const hl7Patient: HL7Patient = {
        id: patient.id,
        mrNumber: patient.mrNumber,
        gender: patient.gender,
        dateOfBirth: patient.dateOfBirth,
        address: patient.address,
        abhaId: patient.abhaId,
        user: patient.user
          ? { name: patient.user.name, phone: patient.user.phone, email: patient.user.email }
          : null,
      };

      const latestAdmission = (patient as any).admissions?.[0];
      const admission: HL7Admission = latestAdmission
        ? {
            visitNumber: latestAdmission.admissionNumber,
            patientClass: "I",
            admittedAt: latestAdmission.admittedAt,
            dischargedAt: latestAdmission.dischargedAt,
          }
        : { patientClass: "O" };

      const message = buildADT_A04(hl7Patient, admission);

      await auditLog(req, "HL7V2_ADT_A04_EXPORT", "Patient", id, {
        messageLength: message.length,
      });
      sendHl7(res, 200, message);
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/v1/hl7v2/lab-order/:id — ORM^O01 ───────────────────────────────

router.get(
  "/lab-order/:id",
  authorize(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const order = await prisma.labOrder.findUnique({
        where: { id },
        include: {
          patient: { include: { user: true } },
          doctor: { include: { user: true } },
          items: { include: { test: true } },
        },
      });
      if (!order) {
        sendError(res, 404, `Lab order ${id} not found`);
        return;
      }

      const hl7Order: HL7LabOrder = {
        id: order.id,
        orderNumber: order.orderNumber,
        orderedAt: order.orderedAt,
        collectedAt: order.collectedAt,
        completedAt: order.completedAt,
        status: order.status,
        priority: order.priority,
        patient: {
          id: order.patient.id,
          mrNumber: order.patient.mrNumber,
          gender: order.patient.gender,
          dateOfBirth: order.patient.dateOfBirth,
          address: order.patient.address,
          abhaId: order.patient.abhaId,
          user: order.patient.user
            ? { name: order.patient.user.name, phone: order.patient.user.phone, email: order.patient.user.email }
            : null,
        },
        doctor: order.doctor
          ? { id: order.doctor.id, user: order.doctor.user ? { name: order.doctor.user.name } : null }
          : null,
        items: (order.items as any[]).map((it) => ({
          id: it.id,
          test: { code: it.test.code, name: it.test.name },
        })),
      };

      const message = buildORM_O01(hl7Order);

      await auditLog(req, "HL7V2_ORM_O01_EXPORT", "LabOrder", id, {
        messageLength: message.length,
        itemCount: hl7Order.items.length,
      });
      sendHl7(res, 200, message);
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/v1/hl7v2/lab-report/:id — ORU^R01 ──────────────────────────────

router.get(
  "/lab-report/:id",
  authorize(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const order = await prisma.labOrder.findUnique({
        where: { id },
        include: {
          patient: { include: { user: true } },
          doctor: { include: { user: true } },
          items: {
            include: { test: true, results: true },
          },
        },
      });
      if (!order) {
        sendError(res, 404, `Lab order ${id} not found`);
        return;
      }

      const hl7Order: HL7LabOrder = {
        id: order.id,
        orderNumber: order.orderNumber,
        orderedAt: order.orderedAt,
        collectedAt: order.collectedAt,
        completedAt: order.completedAt,
        status: order.status,
        priority: order.priority,
        patient: {
          id: order.patient.id,
          mrNumber: order.patient.mrNumber,
          gender: order.patient.gender,
          dateOfBirth: order.patient.dateOfBirth,
          address: order.patient.address,
          abhaId: order.patient.abhaId,
          user: order.patient.user
            ? { name: order.patient.user.name, phone: order.patient.user.phone, email: order.patient.user.email }
            : null,
        },
        doctor: order.doctor
          ? { id: order.doctor.id, user: order.doctor.user ? { name: order.doctor.user.name } : null }
          : null,
        items: (order.items as any[]).map((it) => ({
          id: it.id,
          test: { code: it.test.code, name: it.test.name },
        })),
      };

      // Flatten results, tag each with its parent item's test code/name so the
      // OBX segment can emit a sensible code without re-querying.
      const hl7Results: HL7LabResult[] = [];
      for (const item of (order.items as any[])) {
        for (const r of (item.results as any[]) ?? []) {
          hl7Results.push({
            id: r.id,
            orderItemId: r.orderItemId,
            parameter: r.parameter,
            value: r.value,
            unit: r.unit,
            normalRange: r.normalRange,
            flag: r.flag,
            verifiedAt: r.verifiedAt,
            reportedAt: r.reportedAt,
            testCode: item.test.code,
            testName: item.test.name,
          });
        }
      }

      const message = buildORU_R01(hl7Order, hl7Results);

      await auditLog(req, "HL7V2_ORU_R01_EXPORT", "LabOrder", id, {
        messageLength: message.length,
        resultCount: hl7Results.length,
      });
      sendHl7(res, 200, message);
    } catch (err) {
      next(err);
    }
  }
);

export { router as hl7v2Router };
