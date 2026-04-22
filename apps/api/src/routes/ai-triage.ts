import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import {
  Role,
  startTriageSessionSchema,
  triageMessageSchema,
  bookFromTriageSchema,
} from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { checkRedFlags, buildEmergencyResponse } from "../services/ai/red-flag";
import { runTriageTurn, extractSymptomSummary } from "../services/ai/claude";
import { auditLog } from "../middleware/audit";

const router = Router();

// POST /api/v1/ai/triage/start — create a new triage session (auth optional for patients)
router.post(
  "/start",
  authenticate,
  validate(startTriageSessionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { language, inputMode, patientId, isForDependent, dependentRelationship } = req.body;

      // Resolve patientId from JWT if patient role and not explicitly provided
      let resolvedPatientId = patientId;
      if (!resolvedPatientId && req.user?.role === Role.PATIENT) {
        const patient = await prisma.patient.findFirst({
          where: { userId: req.user.userId },
          select: { id: true },
        });
        resolvedPatientId = patient?.id;
      }

      const greeting =
        language === "hi"
          ? "नमस्ते! मैं आपकी सही डॉक्टर तक पहुँचने में मदद करूँगा। कृपया अपनी तकलीफ बताएँ — आप कैसा महसूस कर रहे हैं?"
          : "Hello! I'm here to help you find the right doctor. Please describe what's bothering you — how are you feeling?";

      const initialMessages = [{ role: "assistant", content: greeting, timestamp: new Date().toISOString() }];

      const session = await prisma.aITriageSession.create({
        data: {
          patientId: resolvedPatientId,
          language,
          inputMode,
          messages: initialMessages as any,
          modelVersion: "claude-sonnet-4-6",
          symptoms: isForDependent ? { isForDependent, dependentRelationship } : undefined,
        },
      });

      res.json({
        success: true,
        data: {
          sessionId: session.id,
          message: greeting,
          language,
          disclaimer:
            language === "hi"
              ? "यह एक अपॉइंटमेंट बुकिंग सहायक है, न कि डायग्नोसिस टूल।"
              : "This is an appointment routing assistant, not a diagnostic tool.",
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/ai/triage/:sessionId/message — send a user message
router.post(
  "/:sessionId/message",
  authenticate,
  validate(triageMessageSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;
      const { message, language: langOverride } = req.body;

      const session = await prisma.aITriageSession.findUnique({ where: { id: sessionId } });
      if (!session) {
        res.status(404).json({ success: false, data: null, error: "Session not found" });
        return;
      }
      if (session.status !== "ACTIVE") {
        res.status(400).json({ success: false, data: null, error: `Session is ${session.status}` });
        return;
      }

      // 1. Deterministic red-flag check first (fast, no LLM cost)
      const redFlag = checkRedFlags(message);
      if (redFlag.detected) {
        const emergencyReply = buildEmergencyResponse(redFlag.reason!);
        await prisma.aITriageSession.update({
          where: { id: sessionId },
          data: {
            status: "EMERGENCY_DETECTED",
            redFlagDetected: true,
            redFlagReason: redFlag.reason,
            messages: [
              ...(session.messages as any[]),
              { role: "user", content: message, timestamp: new Date().toISOString() },
              { role: "assistant", content: emergencyReply, timestamp: new Date().toISOString() },
            ] as any,
          },
        });

        await auditLog(req, "AI_TRIAGE_EMERGENCY_DETECTED", "AITriageSession", sessionId, { redFlagReason: redFlag.reason });

        res.json({
          success: true,
          data: {
            message: emergencyReply,
            isEmergency: true,
            emergencyReason: redFlag.reason,
            sessionStatus: "EMERGENCY_DETECTED",
          },
          error: null,
        });
        return;
      }

      // 2. Build conversation history for Claude
      const existingMessages = session.messages as { role: string; content: string }[];
      const claudeMessages: { role: "user" | "assistant"; content: string }[] = [
        ...existingMessages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user", content: message },
      ];

      // 3. Run Claude turn
      const lang = langOverride || session.language;
      const { reply, isEmergency, emergencyReason } = await runTriageTurn(claudeMessages, lang);

      if (isEmergency) {
        const emergencyReply = buildEmergencyResponse(emergencyReason!);
        await prisma.aITriageSession.update({
          where: { id: sessionId },
          data: {
            status: "EMERGENCY_DETECTED",
            redFlagDetected: true,
            redFlagReason: emergencyReason,
            messages: [
              ...(session.messages as any[]),
              { role: "user", content: message, timestamp: new Date().toISOString() },
              { role: "assistant", content: emergencyReply, timestamp: new Date().toISOString() },
            ] as any,
          },
        });

        res.json({
          success: true,
          data: {
            message: emergencyReply,
            isEmergency: true,
            emergencyReason,
            sessionStatus: "EMERGENCY_DETECTED",
          },
          error: null,
        });
        return;
      }

      // 4. Count user turns — if 5+ turns, extract summary and suggest doctors
      const userTurnCount = existingMessages.filter((m) => m.role === "user").length + 1;
      const updatedMessages = [
        ...(session.messages as any[]),
        { role: "user", content: message, timestamp: new Date().toISOString() },
        { role: "assistant", content: reply, timestamp: new Date().toISOString() },
      ];

      let suggestedSpecialties = null;
      let confidence = null;
      let symptoms = session.symptoms;

      if (userTurnCount >= 4) {
        try {
          const summary = await extractSymptomSummary(
            claudeMessages.concat([{ role: "assistant", content: reply }])
          );
          suggestedSpecialties = summary.specialties as any;
          confidence = summary.confidence;
          symptoms = summary as any;
        } catch {
          // Non-fatal — triage continues without summary
        }
      }

      await prisma.aITriageSession.update({
        where: { id: sessionId },
        data: {
          messages: updatedMessages as any,
          symptoms: symptoms as any,
          suggestedSpecialties: suggestedSpecialties as any,
          confidence,
          chiefComplaint: (symptoms as any)?.chiefComplaint || session.chiefComplaint,
        },
      });

      res.json({
        success: true,
        data: {
          message: reply,
          isEmergency: false,
          turnCount: userTurnCount,
          readyForDoctorSuggestion: userTurnCount >= 4 && !!suggestedSpecialties,
          suggestedSpecialties,
          confidence,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/ai/triage/:sessionId — get session state + doctor suggestions
router.get(
  "/:sessionId",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await prisma.aITriageSession.findUnique({
        where: { id: req.params.sessionId },
      });
      if (!session) {
        res.status(404).json({ success: false, data: null, error: "Session not found" });
        return;
      }

      // Fetch doctor suggestions if specialties are available
      let doctorSuggestions: any[] = [];
      if (session.suggestedSpecialties) {
        const specialties = (session.suggestedSpecialties as any[]).map((s: any) => s.specialty);
        const doctors = await prisma.doctor.findMany({
          where: {
            specialization: { in: specialties },
            user: { isActive: true },
          },
          include: {
            user: { select: { id: true, name: true, photoUrl: true, preferredLanguage: true } },
            schedules: true,
          },
          take: 6,
        });

        doctorSuggestions = doctors.map((d) => {
          const specialty = (session.suggestedSpecialties as any[]).find(
            (s: any) => s.specialty === d.specialization
          );
          return {
            doctorId: d.id,
            name: d.user.name,
            specialty: d.specialization,
            qualification: d.qualification,
            photoUrl: d.user.photoUrl,
            reasoning: specialty?.reasoning || `Specialist in ${d.specialization}`,
            confidence: specialty?.confidence || 0.7,
          };
        });
      }

      res.json({
        success: true,
        data: {
          session: {
            id: session.id,
            status: session.status,
            language: session.language,
            messages: session.messages,
            redFlagDetected: session.redFlagDetected,
            redFlagReason: session.redFlagReason,
            confidence: session.confidence,
          },
          doctorSuggestions,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/ai/triage/:sessionId/book — book appointment from triage
router.post(
  "/:sessionId/book",
  authenticate,
  authorize(Role.PATIENT, Role.RECEPTION, Role.ADMIN),
  validate(bookFromTriageSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;
      const { doctorId, date, slotStart, slotEnd, patientId } = req.body;

      const session = await prisma.aITriageSession.findUnique({ where: { id: sessionId } });
      if (!session) {
        res.status(404).json({ success: false, data: null, error: "Session not found" });
        return;
      }
      if (session.status === "EMERGENCY_DETECTED") {
        res.status(400).json({ success: false, data: null, error: "Cannot book — emergency was detected" });
        return;
      }

      // Build pre-visit summary from session data
      const symptoms = session.symptoms as any;
      const preVisitSummary = {
        chiefComplaint: session.chiefComplaint || symptoms?.chiefComplaint || "Not specified",
        hpi: symptoms?.associatedSymptoms?.join(", ") || "",
        redFlagsNoted: session.redFlagDetected ? [session.redFlagReason!] : [],
        confidence: session.confidence,
        language: session.language,
        transcriptSummary: `AI-assisted triage session. ${(session.messages as any[]).filter((m: any) => m.role === "user").length} patient turns.`,
        capturedAt: new Date().toISOString(),
      };

      const dateObj = new Date(date);
      const dayOfWeek = dateObj.getDay();

      // Get next token number
      const lastAppt = await prisma.appointment.findFirst({
        where: { doctorId, date: dateObj },
        orderBy: { tokenNumber: "desc" },
      });
      const tokenNumber = (lastAppt?.tokenNumber ?? 0) + 1;

      // Verify slot is still available
      const conflict = await prisma.appointment.findFirst({
        where: { doctorId, date: dateObj, slotStart, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
      });
      if (conflict) {
        res.status(409).json({ success: false, data: null, error: "Slot no longer available" });
        return;
      }

      const appointment = await prisma.appointment.create({
        data: {
          patientId,
          doctorId,
          date: dateObj,
          slotStart,
          slotEnd,
          tokenNumber,
          type: "SCHEDULED",
          status: "BOOKED",
          notes: `[AI Triage] ${session.chiefComplaint || "Symptom-based booking"}`,
        },
      });

      // Link session to appointment and mark completed
      await prisma.aITriageSession.update({
        where: { id: sessionId },
        data: {
          appointmentId: appointment.id,
          status: "COMPLETED",
          preVisitSummary: preVisitSummary as any,
        },
      });

      await auditLog(req, "AI_TRIAGE_APPOINTMENT_BOOKED", "Appointment", appointment.id, { sessionId, triageConfidence: session.confidence });

      res.status(201).json({
        success: true,
        data: { appointment, preVisitSummary },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/v1/ai/triage/:sessionId — abandon session
router.delete(
  "/:sessionId",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.aITriageSession.update({
        where: { id: req.params.sessionId },
        data: { status: "ABANDONED" },
      });
      res.json({ success: true, data: null, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as aiTriageRouter };
