import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function nextAncCaseNumber(): Promise<string> {
  const last = await prisma.antenatalCase.findFirst({
    orderBy: { caseNumber: "desc" },
    select: { caseNumber: true },
  });
  let n = 1;
  if (last?.caseNumber) {
    const m = last.caseNumber.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `ANC${String(n).padStart(6, "0")}`;
}

async function main() {
  console.log("=== Seeding Phase 4 Specialty (ANC + Growth) ===\n");

  // Find female patients
  const femalePatients = await prisma.patient.findMany({
    where: { gender: "FEMALE" },
    take: 10,
    include: { user: true },
  });

  const doctors = await prisma.doctor.findMany({ take: 5, include: { user: true } });

  if (femalePatients.length < 3 || doctors.length < 1) {
    console.log(
      "Skipping — need at least 3 female patients and 1 doctor. Run seed-realistic first."
    );
    await prisma.$disconnect();
    return;
  }

  // Pick 3 female patients who don't already have an ANC case
  const eligible: typeof femalePatients = [];
  for (const p of femalePatients) {
    const exists = await prisma.antenatalCase.findUnique({
      where: { patientId: p.id },
    });
    if (!exists) eligible.push(p);
    if (eligible.length === 3) break;
  }

  if (eligible.length < 3) {
    console.log(
      `Only ${eligible.length} eligible patient(s) without existing ANC cases — continuing with what we have.`
    );
  }

  const doctor = doctors[0];
  const now = new Date();

  // Case 1: Active normal — LMP 14 weeks ago
  if (eligible[0]) {
    const lmp = addDays(now, -14 * 7);
    const edd = addDays(lmp, 280);
    const caseNumber = await nextAncCaseNumber();
    const c = await prisma.antenatalCase.create({
      data: {
        caseNumber,
        patientId: eligible[0].id,
        doctorId: doctor.id,
        lmpDate: lmp,
        eddDate: edd,
        gravida: 1,
        parity: 0,
        bloodGroup: "O+",
        isHighRisk: false,
      },
    });
    console.log(`  Created ANC case ${caseNumber} (active, normal) for ${eligible[0].user.name}`);

    // 3 routine visits
    await prisma.ancVisit.createMany({
      data: [
        {
          ancCaseId: c.id,
          type: "FIRST_VISIT",
          visitDate: addDays(lmp, 6 * 7),
          weeksOfGestation: 6,
          weight: 56,
          bloodPressure: "110/70",
          hemoglobin: 11.8,
          urineProtein: "nil",
          urineSugar: "nil",
          prescribedMeds: "Folic acid 5mg OD",
          notes: "Booking visit, first pregnancy.",
          nextVisitDate: addDays(lmp, 10 * 7),
        },
        {
          ancCaseId: c.id,
          type: "ROUTINE",
          visitDate: addDays(lmp, 10 * 7),
          weeksOfGestation: 10,
          weight: 57.2,
          bloodPressure: "112/72",
          hemoglobin: 11.5,
          urineProtein: "nil",
          urineSugar: "nil",
          prescribedMeds: "Folic acid, Iron",
          notes: "Progressing well. USG done.",
          nextVisitDate: addDays(lmp, 14 * 7),
        },
        {
          ancCaseId: c.id,
          type: "ROUTINE",
          visitDate: addDays(lmp, 14 * 7),
          weeksOfGestation: 14,
          weight: 58.5,
          bloodPressure: "118/78",
          fundalHeight: "14",
          fetalHeartRate: 148,
          hemoglobin: 11.2,
          urineProtein: "nil",
          urineSugar: "nil",
          prescribedMeds: "Iron, Calcium",
          notes: "Fetal heart tones audible. Mother feeling well.",
          nextVisitDate: addDays(now, 28),
        },
      ],
    });
  }

  // Case 2: Active high-risk — LMP 28 weeks ago
  if (eligible[1]) {
    const lmp = addDays(now, -28 * 7);
    const edd = addDays(lmp, 280);
    const caseNumber = await nextAncCaseNumber();
    const c = await prisma.antenatalCase.create({
      data: {
        caseNumber,
        patientId: eligible[1].id,
        doctorId: doctor.id,
        lmpDate: lmp,
        eddDate: edd,
        gravida: 3,
        parity: 1,
        bloodGroup: "A+",
        isHighRisk: true,
        riskFactors: "Previous C-section, Hypertension, GDM",
      },
    });
    console.log(
      `  Created ANC case ${caseNumber} (active, high risk) for ${eligible[1].user.name}`
    );

    await prisma.ancVisit.createMany({
      data: [
        {
          ancCaseId: c.id,
          type: "FIRST_VISIT",
          visitDate: addDays(lmp, 8 * 7),
          weeksOfGestation: 8,
          weight: 68,
          bloodPressure: "135/88",
          hemoglobin: 10.8,
          urineProtein: "trace",
          urineSugar: "nil",
          prescribedMeds: "Folic acid, Labetalol 100mg BD",
          notes: "Booking visit. H/o prior LSCS. BP monitoring advised.",
          nextVisitDate: addDays(lmp, 12 * 7),
        },
        {
          ancCaseId: c.id,
          type: "HIGH_RISK_FOLLOWUP",
          visitDate: addDays(lmp, 16 * 7),
          weeksOfGestation: 16,
          weight: 70.1,
          bloodPressure: "140/90",
          fundalHeight: "16",
          fetalHeartRate: 152,
          hemoglobin: 10.5,
          urineProtein: "+",
          urineSugar: "nil",
          prescribedMeds: "Labetalol, Aspirin 75mg",
          notes: "BP elevated. Advised salt restriction.",
          nextVisitDate: addDays(lmp, 22 * 7),
        },
        {
          ancCaseId: c.id,
          type: "SCAN_REVIEW",
          visitDate: addDays(lmp, 22 * 7),
          weeksOfGestation: 22,
          weight: 72,
          bloodPressure: "138/86",
          fundalHeight: "22",
          fetalHeartRate: 144,
          presentation: "Cephalic",
          hemoglobin: 10.4,
          urineProtein: "+",
          urineSugar: "nil",
          notes: "Anomaly scan normal. BP controlled.",
          nextVisitDate: addDays(lmp, 26 * 7),
        },
        {
          ancCaseId: c.id,
          type: "HIGH_RISK_FOLLOWUP",
          visitDate: addDays(lmp, 28 * 7),
          weeksOfGestation: 28,
          weight: 74.5,
          bloodPressure: "142/92",
          fundalHeight: "28",
          fetalHeartRate: 146,
          presentation: "Cephalic",
          hemoglobin: 10.2,
          urineProtein: "+",
          urineSugar: "nil",
          prescribedMeds: "Labetalol, Aspirin, Iron",
          notes: "GTT ordered. Increased monitoring.",
          nextVisitDate: addDays(now, 14),
        },
      ],
    });
  }

  // Case 3: Delivered — LMP 42 weeks ago (delivered 2 weeks ago)
  if (eligible[2]) {
    const lmp = addDays(now, -42 * 7);
    const edd = addDays(lmp, 280);
    const deliveredAt = addDays(edd, -2 * 7);
    const caseNumber = await nextAncCaseNumber();
    const c = await prisma.antenatalCase.create({
      data: {
        caseNumber,
        patientId: eligible[2].id,
        doctorId: doctor.id,
        lmpDate: lmp,
        eddDate: edd,
        gravida: 2,
        parity: 1,
        bloodGroup: "B+",
        isHighRisk: false,
        deliveredAt,
        deliveryType: "NORMAL",
        babyGender: "FEMALE",
        babyWeight: 3.1,
        outcomeNotes: "Normal vaginal delivery. Apgar 9/10. Baby healthy.",
      },
    });
    console.log(
      `  Created ANC case ${caseNumber} (delivered) for ${eligible[2].user.name}`
    );

    await prisma.ancVisit.createMany({
      data: [
        {
          ancCaseId: c.id,
          type: "FIRST_VISIT",
          visitDate: addDays(lmp, 8 * 7),
          weeksOfGestation: 8,
          weight: 60,
          bloodPressure: "118/76",
          hemoglobin: 11.6,
          notes: "Booking visit for 2nd pregnancy.",
        },
        {
          ancCaseId: c.id,
          type: "ROUTINE",
          visitDate: addDays(lmp, 20 * 7),
          weeksOfGestation: 20,
          weight: 63,
          bloodPressure: "120/78",
          fundalHeight: "20",
          fetalHeartRate: 148,
          hemoglobin: 11.2,
          notes: "Progressing well.",
        },
        {
          ancCaseId: c.id,
          type: "ROUTINE",
          visitDate: addDays(lmp, 36 * 7),
          weeksOfGestation: 36,
          weight: 72,
          bloodPressure: "122/80",
          fundalHeight: "36",
          fetalHeartRate: 142,
          presentation: "Cephalic",
          hemoglobin: 11.0,
          notes: "Term approaching.",
        },
        {
          ancCaseId: c.id,
          type: "DELIVERY",
          visitDate: deliveredAt,
          weeksOfGestation: 38,
          weight: 73,
          bloodPressure: "118/78",
          notes: "Normal vaginal delivery. Live female baby 3.1 kg.",
        },
        {
          ancCaseId: c.id,
          type: "POSTNATAL",
          visitDate: addDays(deliveredAt, 7),
          notes: "Mother and baby doing well. Breastfeeding established.",
        },
      ],
    });
  }

  // ─── Growth Records for a young patient ───────────────
  console.log("\nSeeding growth records...");
  const pediatricPatient = await prisma.patient.findFirst({
    where: {
      OR: [
        { dateOfBirth: { gte: addDays(now, -2 * 365), lte: now } },
        { age: { lte: 2 } },
      ],
    },
    include: { user: true },
  });

  if (!pediatricPatient) {
    console.log("  No pediatric patient (< 2y) found — skipping growth seed.");
  } else {
    // Recorder
    const anyStaff =
      (await prisma.user.findFirst({ where: { role: "DOCTOR" } })) ||
      (await prisma.user.findFirst({ where: { role: "NURSE" } }));
    const recordedBy = anyStaff?.id || doctor.userId;

    // Remove existing growth records to prevent duplicates on re-run
    await prisma.growthRecord.deleteMany({
      where: { patientId: pediatricPatient.id },
    });

    const measurements = [
      { ageMonths: 0, weightKg: 3.2, heightCm: 49, headCircumference: 34 },
      { ageMonths: 2, weightKg: 5.4, heightCm: 57, headCircumference: 38, milestoneNotes: "Smiling, cooing" },
      { ageMonths: 4, weightKg: 6.8, heightCm: 62, headCircumference: 40, milestoneNotes: "Good head control" },
      { ageMonths: 6, weightKg: 7.6, heightCm: 66, headCircumference: 42.5, milestoneNotes: "Sitting with support" },
      { ageMonths: 12, weightKg: 9.5, heightCm: 74, headCircumference: 45, milestoneNotes: "Walking, first words", developmentalNotes: "Meeting all expected milestones." },
    ];

    for (const m of measurements) {
      const hMeters = m.heightCm / 100;
      const bmi = Math.round((m.weightKg / (hMeters * hMeters)) * 10) / 10;
      // Rough percentile computation
      const medians: Record<number, { w: number; h: number }> = {
        0: { w: 3.3, h: 49.9 },
        2: { w: 5.6, h: 58.4 },
        4: { w: 7.0, h: 63.9 },
        6: { w: 7.9, h: 67.6 },
        12: { w: 9.6, h: 75.7 },
      };
      const med = medians[m.ageMonths];
      const wp = med
        ? Math.max(1, Math.min(99, Math.round((m.weightKg / med.w) * 50)))
        : null;
      const hp = med
        ? Math.max(1, Math.min(99, Math.round((m.heightCm / med.h) * 50)))
        : null;

      await prisma.growthRecord.create({
        data: {
          patientId: pediatricPatient.id,
          ageMonths: m.ageMonths,
          weightKg: m.weightKg,
          heightCm: m.heightCm,
          headCircumference: m.headCircumference,
          bmi,
          weightPercentile: wp,
          heightPercentile: hp,
          milestoneNotes: m.milestoneNotes,
          developmentalNotes: m.developmentalNotes,
          recordedBy,
        },
      });
    }
    console.log(
      `  Seeded ${measurements.length} growth records for ${pediatricPatient.user.name}`
    );
  }

  console.log("\n=== Phase 4 Specialty seed complete ===");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
