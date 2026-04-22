import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import {
  Role,
  startScribeSessionSchema,
  addTranscriptChunkSchema,
  scribeSignOffSchema,
} from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { generateSOAPNote } from "../services/ai/claude";
import { checkDrugSafety } from "../services/ai/drug-interactions";
import { auditLog } from "../middleware/audit";

const router = Router();
router.use(authenticate);

// POST /api/v1/ai/scribe/start — start a scribe session (doctor only)
router.post(
  "/start",
  authorize(Role.DOCTOR, Role.ADMIN),
  validate(startScribeSessionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { appointmentId, audioRetentionDays } = req.body;

      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          patient: {
            include: {
              allergies: { select: { allergen: true } },
              chronicConditions: { select: { condition: true } },
            },
          },
          doctor: true,
        },
      });

      if (!appointment) {
        res.status(404).json({ success: false, data: null, error: "Appointment not found" });
        return;
      }

      // Ensure caller is the attending doctor (or admin)
      if (req.user?.role === Role.DOCTOR) {
        const doctor = await prisma.doctor.findFirst({ where: { userId: req.user.userId } });
        if (doctor?.id !== appointment.doctorId) {
          res.status(403).json({ success: false, data: null, error: "Not the attending doctor" });
          return;
        }
      }

      // Prevent duplicate sessions
      const existing = await prisma.aIScribeSession.findUnique({ where: { appointmentId } });
      if (existing && existing.status === "ACTIVE") {
        res.json({ success: true, data: { sessionId: existing.id, resumed: true }, error: null });
        return;
      }

      const retainUntil = audioRetentionDays > 0
        ? new Date(Date.now() + audioRetentionDays * 86400000)
        : null;

      const session = await prisma.aIScribeSession.create({
        data: {
          appointmentId,
          doctorId: appointment.doctorId,
          patientId: appointment.patientId,
          consentObtained: true,
          consentAt: new Date(),
          audioRetainUntil: retainUntil,
          modelVersion: "claude-sonnet-4-6",
        },
      });

      await auditLog(req, "AI_SCRIBE_SESSION_STARTED", "AIScribeSession", session.id, { appointmentId, audioRetentionDays });

      res.status(201).json({
        success: true,
        data: {
          sessionId: session.id,
          patientContext: {
            allergies: appointment.patient.allergies.map((a: any) => a.allergen),
            chronicConditions: appointment.patient.chronicConditions.map((c: any) => c.condition),
          },
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/ai/scribe/:sessionId/transcript — add transcript chunks
router.post(
  "/:sessionId/transcript",
  authorize(Role.DOCTOR, Role.ADMIN),
  validate(addTranscriptChunkSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;
      const { entries } = req.body;

      const session = await prisma.aIScribeSession.findUnique({ where: { id: sessionId } });
      if (!session) {
        res.status(404).json({ success: false, data: null, error: "Session not found" });
        return;
      }
      if (session.status !== "ACTIVE") {
        res.status(400).json({ success: false, data: null, error: `Session is ${session.status}` });
        return;
      }

      const existingTranscript = (session.transcript as any[]) || [];
      const updatedTranscript = [...existingTranscript, ...entries];

      // Regenerate SOAP draft every time transcript is updated
      // Fetch patient context for drug interaction checks
      const appointment = await prisma.appointment.findUnique({
        where: { id: session.appointmentId },
        include: {
          patient: {
            include: {
              allergies: { select: { allergen: true } },
              chronicConditions: { select: { condition: true } },
              prescriptions: {
                orderBy: { createdAt: "desc" },
                take: 1,
                include: { items: { select: { medicineName: true } } },
              },
            },
          },
        },
      });

      const patientContext = {
        allergies: appointment?.patient.allergies.map((a: any) => a.allergen) || [],
        currentMedications:
          appointment?.patient.prescriptions[0]?.items.map((i: any) => i.medicineName) || [],
        chronicConditions: appointment?.patient.chronicConditions.map((c: any) => c.condition) || [],
        age: appointment?.patient.age ?? undefined,
        gender: appointment?.patient.gender ?? undefined,
      };

      let soapDraft = session.soapDraft;
      let rxSafetyReport = (session.rxDraft as any) || null;

      // Only regenerate if we have substantial transcript (3+ entries)
      if (updatedTranscript.length >= 3) {
        try {
          soapDraft = await generateSOAPNote(updatedTranscript, patientContext) as any;
        } catch {
          // Non-fatal — keep previous draft
        }

        // Run drug safety checks whenever we have a fresh SOAP draft with medications
        const proposedMeds = (soapDraft as any)?.plan?.medications ?? [];
        if (proposedMeds.length > 0) {
          try {
            rxSafetyReport = await checkDrugSafety(
              proposedMeds,
              patientContext.currentMedications,
              patientContext.allergies,
              patientContext.chronicConditions,
              { age: patientContext.age, gender: patientContext.gender }
            );
          } catch {
            // Non-fatal — continue without safety report
          }
        }
      }

      await prisma.aIScribeSession.update({
        where: { id: sessionId },
        data: {
          transcript: updatedTranscript as any,
          soapDraft: soapDraft as any,
          rxDraft: rxSafetyReport as any,
        },
      });

      res.json({
        success: true,
        data: {
          transcriptLength: updatedTranscript.length,
          soapDraftUpdated: !!soapDraft,
          soapDraft,
          rxSafetyReport,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/ai/scribe/:sessionId/soap — get current SOAP draft
router.get(
  "/:sessionId/soap",
  authorize(Role.DOCTOR, Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await prisma.aIScribeSession.findUnique({
        where: { id: req.params.sessionId },
        select: {
          id: true,
          status: true,
          soapDraft: true,
          soapFinal: true,
          icd10Codes: true,
          rxDraft: true,
          transcript: true,
          signedOffAt: true,
          signedOffBy: true,
        },
      });

      if (!session) {
        res.status(404).json({ success: false, data: null, error: "Session not found" });
        return;
      }

      res.json({ success: true, data: session, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/ai/scribe/:sessionId/finalize — doctor signs off
router.post(
  "/:sessionId/finalize",
  authorize(Role.DOCTOR),
  validate(scribeSignOffSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;
      const { soapFinal, icd10Codes, rxApproved, doctorEdits } = req.body;

      const session = await prisma.aIScribeSession.findUnique({ where: { id: sessionId } });
      if (!session) {
        res.status(404).json({ success: false, data: null, error: "Session not found" });
        return;
      }

      const doctor = await prisma.doctor.findFirst({ where: { userId: req.user!.userId } });
      if (doctor?.id !== session.doctorId) {
        res.status(403).json({ success: false, data: null, error: "Not the attending doctor" });
        return;
      }

      const finalSession = await prisma.aIScribeSession.update({
        where: { id: sessionId },
        data: {
          status: "COMPLETED",
          soapFinal: soapFinal as any,
          icd10Codes: icd10Codes as any,
          doctorEdits: doctorEdits as any,
          signedOffAt: new Date(),
          signedOffBy: req.user!.userId,
        },
      });

      // Write SOAP note to EHR (consultation record)
      if (soapFinal) {
        const existingConsultation = await prisma.consultation.findUnique({
          where: { appointmentId: session.appointmentId },
        });

        const notes = `[AI Scribe — Doctor Approved]\n\nSubjective: ${JSON.stringify(soapFinal.subjective)}\n\nObjective: ${JSON.stringify(soapFinal.objective)}\n\nAssessment: ${soapFinal.assessment?.impression}\n\nPlan: ${JSON.stringify(soapFinal.plan)}`;

        if (existingConsultation) {
          await prisma.consultation.update({
            where: { appointmentId: session.appointmentId },
            data: { notes },
          });
        } else {
          await prisma.consultation.create({
            data: {
              appointmentId: session.appointmentId,
              doctorId: session.doctorId,
              notes,
              findings: soapFinal.objective?.examinationFindings || "",
            },
          });
        }
      }

      await auditLog(req, "AI_SCRIBE_SIGNED_OFF", "AIScribeSession", sessionId, { rxApproved, editCount: doctorEdits?.length || 0 });

      res.json({ success: true, data: { session: finalSession }, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/v1/ai/scribe/:sessionId — withdraw consent, purge transcript
router.delete(
  "/:sessionId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.aIScribeSession.update({
        where: { id: req.params.sessionId },
        data: {
          status: "CONSENT_WITHDRAWN",
          transcript: [] as any,
          soapDraft: null,
        },
      });

      await auditLog(req, "AI_SCRIBE_CONSENT_WITHDRAWN", "AIScribeSession", req.params.sessionId, {});

      res.json({ success: true, data: null, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as aiScribeRouter };
