import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import { Role, dashboardPreferenceSchema } from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { auditLog } from "../middleware/audit";
import { computePatientBaseline } from "../services/vitals-baseline";

const router = Router();
router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────

function escapeHtml(text: string): string {
  return (text ?? "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── GET /patients/:id/vitals-baseline ────────────────

router.get(
  "/patients/:id/vitals-baseline",
  authorize(Role.ADMIN, Role.DOCTOR, Role.NURSE, Role.RECEPTION),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const baseline = await computePatientBaseline(req.params.id);
      res.json({ success: true, data: baseline, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /patients/:id/vitals/pdf ─────────────────────

router.get(
  "/patients/:id/vitals/pdf",
  authorize(Role.ADMIN, Role.DOCTOR, Role.NURSE, Role.RECEPTION),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = req.params.id;
      const { from, to } = req.query;

      const where: Record<string, unknown> = { patientId };
      if (from || to) {
        where.recordedAt = {
          ...(from ? { gte: new Date(from as string) } : {}),
          ...(to ? { lte: new Date(to as string) } : {}),
        };
      }

      const [patient, vitals, hospitalCfg] = await Promise.all([
        prisma.patient.findUnique({
          where: { id: patientId },
          include: { user: { select: { name: true, phone: true } } },
        }),
        prisma.vitals.findMany({
          where: where as any,
          orderBy: { recordedAt: "asc" },
        }),
        prisma.systemConfig.findMany({
          where: { key: { in: ["hospital_name", "hospital_address", "hospital_phone"] } },
        }),
      ]);

      if (!patient) {
        res.status(404).json({ success: false, data: null, error: "Patient not found" });
        return;
      }

      const cfgMap: Record<string, string> = {};
      hospitalCfg.forEach((c) => (cfgMap[c.key] = c.value));

      const rows = vitals
        .map((v) => {
          const date = new Date(v.recordedAt).toLocaleString("en-IN");
          const bp =
            v.bloodPressureSystolic && v.bloodPressureDiastolic
              ? `${v.bloodPressureSystolic}/${v.bloodPressureDiastolic}`
              : "—";
          const temp = v.temperature
            ? `${v.temperature}°${escapeHtml(v.temperatureUnit || "F")}`
            : "—";
          const flags = v.abnormalFlags
            ? `<span style="color:#dc2626;font-weight:500;">${escapeHtml(v.abnormalFlags)}</span>`
            : "";
          return `
            <tr>
              <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${escapeHtml(date)}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${bp}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${v.pulseRate ?? "—"}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${v.spO2 ?? "—"}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${temp}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${v.respiratoryRate ?? "—"}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${v.weight ?? "—"}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${v.bmi ?? "—"}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:11px;">${flags}</td>
            </tr>`;
        })
        .join("\n");

      // Simple inline trend data
      const systolicPoints = vitals
        .map((v) => v.bloodPressureSystolic)
        .filter((x): x is number => typeof x === "number");
      const minSys = systolicPoints.length ? Math.min(...systolicPoints) : 0;
      const maxSys = systolicPoints.length ? Math.max(...systolicPoints) : 0;
      const avgSys =
        systolicPoints.length > 0
          ? (systolicPoints.reduce((a, b) => a + b, 0) / systolicPoints.length).toFixed(1)
          : "—";

      const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><title>Vitals Report - ${escapeHtml(patient.user.name)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; margin: 0; padding: 0; }
  .page { max-width: 1100px; margin: 0 auto; padding: 32px; }
  table { width:100%; border-collapse: collapse; }
  th { background:#f8fafc; text-align:left; padding:8px; font-size:11px; text-transform:uppercase; color:#64748b; border-bottom:2px solid #e2e8f0; }
  @media print { .no-print { display:none !important } .page { padding: 16px } }
</style></head>
<body><div class="page">
<div style="text-align:center;border-bottom:3px double #2563eb;padding-bottom:12px;margin-bottom:16px;">
  <h1 style="font-size:22px;color:#2563eb;margin:0;">${escapeHtml(cfgMap.hospital_name || "Hospital")}</h1>
  ${cfgMap.hospital_address ? `<p style="font-size:12px;color:#64748b;margin:3px 0;">${escapeHtml(cfgMap.hospital_address)}</p>` : ""}
</div>
<h2 style="text-align:center;font-size:16px;letter-spacing:1.5px;text-transform:uppercase;color:#475569;margin-bottom:16px;">Vitals Report</h2>
<div style="display:flex;justify-content:space-between;margin-bottom:18px;font-size:13px;">
  <div>
    <p><strong>Patient:</strong> ${escapeHtml(patient.user.name)}</p>
    <p><strong>MR#:</strong> ${escapeHtml(patient.mrNumber)}</p>
    ${patient.age != null ? `<p><strong>Age:</strong> ${patient.age}</p>` : ""}
    <p><strong>Gender:</strong> ${escapeHtml(patient.gender)}</p>
  </div>
  <div style="text-align:right;">
    <p><strong>Generated:</strong> ${new Date().toLocaleString("en-IN")}</p>
    <p><strong>Period:</strong> ${from ? escapeHtml(from as string) : "—"} → ${to ? escapeHtml(to as string) : "Present"}</p>
    <p><strong>Readings:</strong> ${vitals.length}</p>
  </div>
</div>

<div style="background:#f1f5f9;border-left:4px solid #2563eb;padding:10px 14px;margin-bottom:16px;font-size:13px;border-radius:0 6px 6px 0;">
  <strong>Systolic BP summary:</strong> min ${minSys || "—"}, max ${maxSys || "—"}, avg ${avgSys}
</div>

<table>
<thead><tr>
<th>Date/Time</th><th style="text-align:center;">BP (mmHg)</th><th style="text-align:center;">Pulse</th><th style="text-align:center;">SpO2 (%)</th>
<th style="text-align:center;">Temp</th><th style="text-align:center;">Resp</th><th style="text-align:center;">Weight (kg)</th><th style="text-align:center;">BMI</th><th>Flags</th>
</tr></thead>
<tbody>${rows || `<tr><td colspan="9" style="padding:20px;text-align:center;color:#94a3b8;">No vitals recorded.</td></tr>`}</tbody>
</table>

<div class="no-print" style="text-align:center;margin-top:24px;">
  <button onclick="window.print()" style="background:#2563eb;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;">Print / Save as PDF</button>
</div>
</div></body></html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /patients/:id/ccda — medical record summary ──

router.get(
  "/patients/:id/ccda",
  authorize(Role.ADMIN, Role.DOCTOR, Role.NURSE, Role.RECEPTION, Role.PATIENT),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = req.params.id;

      const [
        patient,
        allergies,
        conditions,
        immunizations,
        recentVitals,
        recentLabResults,
        recentSurgeries,
        activePrescriptions,
      ] = await Promise.all([
        prisma.patient.findUnique({
          where: { id: patientId },
          include: {
            user: { select: { name: true, email: true, phone: true } },
          },
        }),
        prisma.patientAllergy.findMany({
          where: { patientId },
          orderBy: { notedAt: "desc" },
        }),
        prisma.chronicCondition.findMany({
          where: { patientId, status: "ACTIVE" },
          orderBy: { diagnosedDate: "desc" },
        }),
        prisma.immunization.findMany({
          where: { patientId },
          orderBy: { dateGiven: "desc" },
        }),
        prisma.vitals.findMany({
          where: { patientId },
          orderBy: { recordedAt: "desc" },
          take: 5,
        }),
        prisma.labResult.findMany({
          where: { orderItem: { order: { patientId } } },
          orderBy: { reportedAt: "desc" },
          take: 20,
          include: {
            orderItem: { include: { test: true, order: true } },
          },
        }),
        prisma.surgery.findMany({
          where: { patientId },
          orderBy: { scheduledAt: "desc" },
          take: 10,
          include: {
            surgeon: { include: { user: { select: { name: true } } } },
          },
        }),
        prisma.prescription.findMany({
          where: { patientId },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { items: true },
        }),
      ]);

      if (!patient) {
        res
          .status(404)
          .json({ success: false, data: null, error: "Patient not found" });
        return;
      }

      const doc = {
        generatedAt: new Date().toISOString(),
        documentType: "CCDA_SIMPLIFIED",
        patient: {
          id: patient.id,
          mrNumber: patient.mrNumber,
          name: patient.user.name,
          email: patient.user.email,
          phone: patient.user.phone,
          dateOfBirth: patient.dateOfBirth,
          age: patient.age,
          gender: patient.gender,
          bloodGroup: patient.bloodGroup,
          address: patient.address,
          maritalStatus: patient.maritalStatus,
          occupation: patient.occupation,
          preferredLanguage: patient.preferredLanguage,
          abhaId: patient.abhaId,
        },
        emergencyContacts: patient.emergencyContactName
          ? [
              {
                name: patient.emergencyContactName,
                phone: patient.emergencyContactPhone,
              },
            ]
          : [],
        activeProblems: conditions.map((c) => ({
          condition: c.condition,
          icd10Code: c.icd10Code,
          diagnosedDate: c.diagnosedDate,
          status: c.status,
          notes: c.notes,
        })),
        allergies: allergies.map((a) => ({
          allergen: a.allergen,
          severity: a.severity,
          reaction: a.reaction,
          notes: a.notes,
          notedAt: a.notedAt,
        })),
        currentMedications: activePrescriptions.flatMap((p) =>
          p.items.map((it) => ({
            prescriptionId: p.id,
            medicineName: it.medicineName,
            dosage: it.dosage,
            frequency: it.frequency,
            duration: it.duration,
            instructions: it.instructions,
            prescribedAt: p.createdAt,
          }))
        ),
        recentVitals: recentVitals.map((v) => ({
          recordedAt: v.recordedAt,
          bloodPressure:
            v.bloodPressureSystolic && v.bloodPressureDiastolic
              ? `${v.bloodPressureSystolic}/${v.bloodPressureDiastolic}`
              : null,
          pulseRate: v.pulseRate,
          spO2: v.spO2,
          temperature: v.temperature,
          temperatureUnit: v.temperatureUnit,
          weight: v.weight,
          height: v.height,
          bmi: v.bmi,
          respiratoryRate: v.respiratoryRate,
          isAbnormal: v.isAbnormal,
          abnormalFlags: v.abnormalFlags,
        })),
        recentLabResults: recentLabResults.map((r) => ({
          test: r.orderItem.test.name,
          value: r.value,
          unit: r.unit,
          flag: r.flag,
          reportedAt: r.reportedAt,
          orderNumber: r.orderItem.order.orderNumber,
        })),
        recentProcedures: recentSurgeries.map((s: any) => ({
          procedureName: s.procedure,
          scheduledAt: s.scheduledAt,
          status: s.status,
          surgeon: s.surgeon?.user?.name,
          notes: s.notes ?? null,
        })),
        immunizations: immunizations.map((im) => ({
          vaccine: im.vaccine,
          doseNumber: im.doseNumber,
          dateGiven: im.dateGiven,
          nextDueDate: im.nextDueDate,
          batchNumber: im.batchNumber,
          manufacturer: im.manufacturer,
        })),
      };

      auditLog(req, "EXPORT_CCDA", "patient", patient.id).catch(console.error);

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ccda-${patient.mrNumber}.json"`
      );
      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify(doc, null, 2));
    } catch (err) {
      next(err);
    }
  }
);

// ─── User dashboard preferences ───────────────────────

router.get(
  "/users/me/dashboard-preferences",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const pref = await prisma.userDashboardPreference.findUnique({
        where: { userId },
      });
      res.json({
        success: true,
        data: pref ?? { userId, layout: { widgets: [] } },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/users/me/dashboard-preferences",
  validate(dashboardPreferenceSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const layout = req.body.layout;
      const saved = await prisma.userDashboardPreference.upsert({
        where: { userId },
        update: { layout: layout as any },
        create: { userId, layout: layout as any },
      });
      res.json({ success: true, data: saved, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as patientExtrasRouter };
