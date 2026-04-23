import { tenantScopedPrisma as prisma } from "../tenant-prisma";
import { generateStructured } from "./sarvam";
import { sanitizeUserInput } from "./prompt-safety";

/**
 * One item on the pre-visit checklist. Intended to be displayed as a
 * checkbox row in the mobile app.
 */
export interface PrevisitItem {
  label: string;
  category:
    | "ID"
    | "REPORT"
    | "MEDICATION"
    | "INSURANCE"
    | "PAYMENT"
    | "OTHER";
  required: boolean;
  reason: string;
}

export interface PrevisitChecklistResult {
  items: PrevisitItem[];
}

const SYSTEM_PROMPT =
  "You are MedCore's pre-visit assistant. Given an upcoming appointment and a compact summary of the patient's recent clinical history, produce a checklist of things the patient should bring: identity documents, insurance card, past lab reports, ongoing prescriptions, imaging films, payment method. Always include a government ID. Mark items as required:true only when clearly needed based on the history (e.g. a repeat lab review). Return 4-8 items total. Keep labels short (<=60 chars). Keep reasons short (<=120 chars).";

const ITEMS_TOOL_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          category: {
            type: "string",
            enum: [
              "ID",
              "REPORT",
              "MEDICATION",
              "INSURANCE",
              "PAYMENT",
              "OTHER",
            ],
          },
          required: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["label", "category", "required", "reason"],
      },
    },
  },
  required: ["items"],
};

function deterministicFallback(
  ctx: {
    hasInsurance: boolean;
    hasOngoingMeds: boolean;
    hasRecentLabs: boolean;
    specialty?: string;
  }
): PrevisitItem[] {
  const items: PrevisitItem[] = [
    {
      label: "Government photo ID (Aadhaar / PAN / passport)",
      category: "ID",
      required: true,
      reason: "Required for registration and digital health ID linking.",
    },
    {
      label: "List of allergies & chronic conditions",
      category: "OTHER",
      required: true,
      reason: "Helps the doctor avoid contraindicated prescriptions.",
    },
  ];

  if (ctx.hasInsurance) {
    items.push({
      label: "Insurance card / policy document",
      category: "INSURANCE",
      required: true,
      reason: "Needed for cashless claims at billing.",
    });
  }

  if (ctx.hasOngoingMeds) {
    items.push({
      label: "Current prescription and pill boxes",
      category: "MEDICATION",
      required: true,
      reason: "Doctor will review ongoing medications before changes.",
    });
  }

  if (ctx.hasRecentLabs) {
    items.push({
      label: "Recent lab reports (last 3 months)",
      category: "REPORT",
      required: true,
      reason: "So the doctor can compare trends instead of re-ordering tests.",
    });
  } else {
    items.push({
      label: "Any past lab or imaging reports",
      category: "REPORT",
      required: false,
      reason: "Useful if the doctor needs baseline values.",
    });
  }

  items.push({
    label: "Payment method (cash / card / UPI)",
    category: "PAYMENT",
    required: true,
    reason: "For consultation and any dispensed medication.",
  });

  return items;
}

/**
 * Build the context blob sent to the LLM. Kept separate so it is testable and
 * so the deterministic fallback can reuse the same shape.
 */
async function buildAppointmentContext(appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      doctor: {
        select: {
          id: true,
          specialization: true,
          user: { select: { name: true } },
        },
      },
      patient: {
        select: {
          id: true,
          userId: true,
          age: true,
          gender: true,
          insuranceProvider: true,
          preferredLanguage: true,
          allergies: { select: { allergen: true } },
          chronicConditions: { select: { condition: true } },
        },
      },
    },
  });

  if (!appointment) {
    return null;
  }

  const [recentConsultations, recentPrescriptions, recentLabOrders] =
    await Promise.all([
      prisma.consultation.findMany({
        where: {
          appointment: { patientId: appointment.patientId },
        },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { findings: true, notes: true, createdAt: true },
      }),
      prisma.prescription.findMany({
        where: { patientId: appointment.patientId },
        orderBy: { createdAt: "desc" },
        take: 2,
        include: { items: { select: { medicineName: true, duration: true } } },
      }),
      prisma.labOrder.findMany({
        where: { patientId: appointment.patientId },
        orderBy: { orderedAt: "desc" },
        take: 3,
        select: {
          orderNumber: true,
          orderedAt: true,
          items: { select: { testId: true } },
        },
      }),
    ]);

  return {
    appointment,
    recentConsultations,
    recentPrescriptions,
    recentLabOrders,
  };
}

/**
 * Generate a pre-visit checklist for an appointment. Deterministic given the
 * same inputs and cheap enough to regenerate on demand.
 */
export async function generatePrevisitChecklist(
  appointmentId: string
): Promise<PrevisitChecklistResult | null> {
  const ctx = await buildAppointmentContext(appointmentId);
  if (!ctx) return null;

  const { appointment, recentConsultations, recentPrescriptions, recentLabOrders } =
    ctx;

  const fallbackCtx = {
    hasInsurance: !!appointment.patient?.insuranceProvider,
    hasOngoingMeds:
      recentPrescriptions.length > 0 && recentPrescriptions[0].items.length > 0,
    hasRecentLabs: recentLabOrders.length > 0,
    specialty: appointment.doctor?.specialization ?? undefined,
  };

  const historyLines: string[] = [];
  historyLines.push(
    `Specialty: ${sanitizeUserInput(appointment.doctor?.specialization ?? "General", { maxLen: 80 })}`
  );
  historyLines.push(
    `Patient: age ${appointment.patient?.age ?? "unknown"}, ${sanitizeUserInput(appointment.patient?.gender ?? "", { maxLen: 20 })}`
  );
  historyLines.push(
    `Chronic conditions: ${appointment.patient?.chronicConditions.map((c: any) => sanitizeUserInput(c.condition, { maxLen: 60 })).join(", ") || "none"}`
  );
  historyLines.push(
    `Allergies: ${appointment.patient?.allergies.map((a: any) => sanitizeUserInput(a.allergen, { maxLen: 60 })).join(", ") || "none"}`
  );
  historyLines.push(
    `Ongoing meds: ${recentPrescriptions[0]?.items.map((i: any) => sanitizeUserInput(i.medicineName, { maxLen: 80 })).join(", ") || "none"}`
  );
  historyLines.push(
    `Recent lab orders: ${recentLabOrders.length}`
  );
  historyLines.push(
    `Insurance on file: ${appointment.patient?.insuranceProvider ? "yes" : "no"}`
  );
  if (recentConsultations[0]?.findings) {
    historyLines.push(
      `Most recent consultation findings: ${sanitizeUserInput(recentConsultations[0].findings, { maxLen: 400 })}`
    );
  }

  const userPrompt = `Upcoming appointment:\n${historyLines.join("\n")}\n\nGenerate the checklist.`;

  try {
    const { data } = await generateStructured<{ items: PrevisitItem[] }>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      toolName: "build_previsit_checklist",
      toolDescription:
        "Return an array of 4-8 checklist items the patient should bring to the upcoming appointment.",
      parameters: ITEMS_TOOL_SCHEMA,
      maxTokens: 800,
      temperature: 0.2,
    });

    if (data && Array.isArray(data.items) && data.items.length > 0) {
      return { items: data.items };
    }
  } catch {
    // fall through to deterministic fallback
  }

  return { items: deterministicFallback(fallbackCtx) };
}
