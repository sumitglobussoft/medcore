import { prisma } from "@medcore/db";

export interface VitalBaselineStat {
  baseline: number | null;
  stdDev: number | null;
  sampleSize: number;
}

export interface PatientVitalsBaseline {
  bpSystolic: VitalBaselineStat;
  bpDiastolic: VitalBaselineStat;
  pulse: VitalBaselineStat;
  spO2: VitalBaselineStat;
  temperature: VitalBaselineStat;
  respiratoryRate: VitalBaselineStat;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function stdDev(nums: number[]): number | null {
  if (nums.length < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance =
    nums.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function pick(
  rows: Array<Record<string, unknown>>,
  key: string
): number[] {
  return rows
    .map((r) => r[key])
    .filter((v): v is number => typeof v === "number" && !isNaN(v));
}

/**
 * Computes the patient's personal baseline for each vital using the median
 * of the last 10 non-abnormal readings.
 */
export async function computePatientBaseline(
  patientId: string,
  sampleSize = 10
): Promise<PatientVitalsBaseline> {
  const rows = await prisma.vitals.findMany({
    where: { patientId, isAbnormal: false },
    orderBy: { recordedAt: "desc" },
    take: sampleSize,
  });

  const makeStat = (vals: number[]): VitalBaselineStat => ({
    baseline: median(vals),
    stdDev: stdDev(vals),
    sampleSize: vals.length,
  });

  return {
    bpSystolic: makeStat(pick(rows as any, "bloodPressureSystolic")),
    bpDiastolic: makeStat(pick(rows as any, "bloodPressureDiastolic")),
    pulse: makeStat(pick(rows as any, "pulseRate")),
    spO2: makeStat(pick(rows as any, "spO2")),
    temperature: makeStat(pick(rows as any, "temperature")),
    respiratoryRate: makeStat(pick(rows as any, "respiratoryRate")),
  };
}

export interface VitalsChange {
  field: string;
  previous: number | null;
  current: number | null;
  delta: number | null;
  threshold: number;
  significant: boolean;
}

export interface SuddenChangeResult {
  changes: VitalsChange[];
  hasSignificantChange: boolean;
  previousRecordedAt: string | null;
}

/**
 * Compares new vitals against the last recorded vitals within the past 24h.
 * Returns significant changes based on configured thresholds.
 */
export async function detectSuddenChanges(
  patientId: string,
  current: {
    bloodPressureSystolic?: number | null;
    bloodPressureDiastolic?: number | null;
    pulseRate?: number | null;
    spO2?: number | null;
    temperature?: number | null;
    temperatureUnit?: string | null;
  }
): Promise<SuddenChangeResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const prev = await prisma.vitals.findFirst({
    where: { patientId, recordedAt: { gte: since } },
    orderBy: { recordedAt: "desc" },
  });

  const changes: VitalsChange[] = [];

  function add(
    field: string,
    p: number | null | undefined,
    c: number | null | undefined,
    threshold: number
  ) {
    const prevVal = typeof p === "number" ? p : null;
    const currVal = typeof c === "number" ? c : null;
    let delta: number | null = null;
    let significant = false;
    if (prevVal !== null && currVal !== null) {
      delta = currVal - prevVal;
      significant = Math.abs(delta) >= threshold;
    }
    changes.push({
      field,
      previous: prevVal,
      current: currVal,
      delta,
      threshold,
      significant,
    });
  }

  if (prev) {
    add(
      "bloodPressureSystolic",
      prev.bloodPressureSystolic,
      current.bloodPressureSystolic,
      20
    );
    add(
      "bloodPressureDiastolic",
      prev.bloodPressureDiastolic,
      current.bloodPressureDiastolic,
      15
    );
    add("pulseRate", prev.pulseRate, current.pulseRate, 20);

    // SpO2 drop only flagged on drop >= 3
    const prevSpo2 = prev.spO2;
    const currSpo2 = current.spO2 ?? null;
    const spO2Delta =
      typeof prevSpo2 === "number" && typeof currSpo2 === "number"
        ? currSpo2 - prevSpo2
        : null;
    changes.push({
      field: "spO2",
      previous: prevSpo2 ?? null,
      current: currSpo2,
      delta: spO2Delta,
      threshold: -3,
      significant: spO2Delta !== null && spO2Delta <= -3,
    });

    // Temperature - convert to Fahrenheit for comparison if needed
    const toF = (v: number | null | undefined, unit: string | null | undefined) =>
      typeof v === "number"
        ? (unit ?? "F") === "C"
          ? (v * 9) / 5 + 32
          : v
        : null;
    const prevTempF = toF(prev.temperature, prev.temperatureUnit);
    const currTempF = toF(current.temperature, current.temperatureUnit);
    const tempDelta =
      prevTempF !== null && currTempF !== null ? currTempF - prevTempF : null;
    changes.push({
      field: "temperature",
      previous: prev.temperature ?? null,
      current: current.temperature ?? null,
      delta: tempDelta === null ? null : +tempDelta.toFixed(1),
      threshold: 1.8, // 1°C ≈ 1.8°F
      significant: tempDelta !== null && Math.abs(tempDelta) >= 1.8,
    });
  }

  return {
    changes,
    hasSignificantChange: changes.some((c) => c.significant),
    previousRecordedAt: prev?.recordedAt.toISOString() ?? null,
  };
}

/**
 * Compares value to baseline. Returns true if >20% change from baseline.
 */
export function isBaselineDeviation(
  value: number | null | undefined,
  baseline: number | null
): boolean {
  if (typeof value !== "number" || baseline === null || baseline === 0) {
    return false;
  }
  return Math.abs((value - baseline) / baseline) > 0.2;
}
