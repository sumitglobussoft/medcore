// Operations capacity forecasting service (PRD §7.3).
//
// Given the next 24-72h horizon, this module predicts bed, operating-theatre
// and ICU demand by:
//   1. Pulling the last 180 days of historical admissions / surgeries keyed by
//      resource bucket (ward for beds/ICU, OT for surgeries).
//   2. Fitting a Holt-Winters weekly-seasonal model on the daily inflow series
//      (reusing `./ml/holt-winters`).
//   3. Cross-referencing current occupancy and planned discharges (for beds /
//      ICU) or already-scheduled surgery load (for OTs) to derive an
//      `expectedOccupancyPct`, a boolean `expectedStockout` flag and a
//      qualitative `confidence` band ("low" | "medium" | "high").
//
// Core forecasting logic is deterministic — no LLM call is made inside this
// module so output is reproducible and test-friendly.  Callers who want a
// qualitative narrative should feed the result to `sarvam.ts` separately.
//
// When fewer than 30 days of history exist we degrade to a 7-day moving
// average baseline and label every point `method: "fallback-moving-average"`
// with `confidence: "low"` and `insufficientData: true`.

import { tenantScopedPrisma as prisma } from "../tenant-prisma";
import { holtWinters, type HoltWintersResult } from "./ml/holt-winters";

// ── Public types ──────────────────────────────────────────────────────────────

export type CapacityHorizonHours = 24 | 48 | 72;

export type CapacityConfidence = "low" | "medium" | "high";

export type CapacityMethod = "holt-winters" | "fallback-moving-average";

/** One forecast row — either a Ward (for beds/ICU) or an OT (for surgery). */
export interface CapacityForecastRow {
  resourceId: string;
  resourceName: string;
  resourceType: "ward" | "ot";
  /** Total capacity slots (bed count for wards, 1 for an OT) over the horizon. */
  capacityUnits: number;
  /** Units currently in use right now. */
  currentlyInUse: number;
  /** Units expected to free up over the horizon (planned discharges / OT windows). */
  plannedReleases: number;
  /** Point forecast of inflow (admissions / surgeries) over the horizon. */
  predictedInflow: number;
  /** Upper 95% bound of inflow — used to flag stockout risk. */
  predictedInflowUpper: number;
  /** Expected occupancy % at peak during the horizon (0-200; can exceed 100). */
  expectedOccupancyPct: number;
  /** True when the upper-bound inflow exceeds free capacity. */
  expectedStockout: boolean;
  confidence: CapacityConfidence;
  method: CapacityMethod;
  /** True when we had < 30 days of history and fell back. */
  insufficientData: boolean;
}

export interface CapacityForecastResponse {
  horizonHours: CapacityHorizonHours;
  generatedAt: string;
  forecasts: CapacityForecastRow[];
  /** House-wide aggregate, handy for dashboard headline numbers. */
  summary: {
    totalCapacity: number;
    totalCurrentlyInUse: number;
    totalPredictedInflow: number;
    totalPredictedInflowUpper: number;
    aggregateOccupancyPct: number;
    anyStockoutRisk: boolean;
    wardsAtRisk: number;
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const HISTORY_DAYS = 180;
const MIN_HISTORY_FOR_HW = 30;

function dayBucket(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Bucket date-stamped events into a daily count series (oldest → newest,
 * length = days, zero-filled).  Events outside the window are ignored.
 */
export function buildDailyCountSeries(
  events: Array<{ at: Date | string }>,
  days: number,
  now: Date = new Date()
): number[] {
  const series = new Array<number>(days).fill(0);
  const msPerDay = 1000 * 60 * 60 * 24;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  for (const ev of events) {
    const at = ev.at instanceof Date ? ev.at : new Date(ev.at);
    if (at < start || at > end) continue;
    const idx = Math.floor((at.getTime() - start.getTime()) / msPerDay);
    if (idx >= 0 && idx < days) series[idx] += 1;
  }
  return series;
}

/** Sum the last `window` elements of a series (7-day moving average numerator). */
function sumLast(arr: number[], window: number): number {
  const w = Math.min(window, arr.length);
  let s = 0;
  for (let i = arr.length - w; i < arr.length; i++) s += arr[i];
  return s;
}

interface ForecastOutput {
  pointForecast: number;
  upperForecast: number;
  method: CapacityMethod;
  confidence: CapacityConfidence;
  insufficientData: boolean;
}

/**
 * Forecast the total inflow over `horizonDays` for a single daily-count
 * series.  Holt-Winters weekly seasonality when we have ≥30 days, else a
 * 7-day moving-average fallback.
 */
export function forecastInflow(
  series: number[],
  horizonDays: number
): ForecastOutput {
  const effectiveHistory = series.length;

  if (effectiveHistory < MIN_HISTORY_FOR_HW) {
    // Fallback: 7-day moving average → replicate across horizon
    const recent = sumLast(series, 7);
    const dailyAvg = recent / Math.max(1, Math.min(7, effectiveHistory));
    const point = dailyAvg * horizonDays;
    // Conservative 30% uplift for uncertainty
    const upper = point * 1.3;
    return {
      pointForecast: Math.max(0, Math.round(point)),
      upperForecast: Math.max(0, Math.round(upper)),
      method: "fallback-moving-average",
      confidence: "low",
      insufficientData: true,
    };
  }

  try {
    const fit: HoltWintersResult = holtWinters(series, Math.max(1, horizonDays), {
      period: 7,
      alpha: 0.3,
      beta: 0.05,
      gamma: 0.1,
    });

    let point = 0;
    let upper = 0;
    for (const p of fit.forecast) {
      if (!isFinite(p.yhat)) throw new Error("non-finite forecast");
      point += Math.max(0, p.yhat);
      upper += Math.max(0, p.upper);
    }

    // Confidence from sigma relative to mean daily rate.
    const mean = series.reduce((s, v) => s + v, 0) / series.length;
    const cv = mean > 0.0001 ? fit.sigma / mean : 1;
    let confidence: CapacityConfidence;
    if (effectiveHistory >= 120 && cv < 0.5) confidence = "high";
    else if (effectiveHistory >= 60 && cv < 1.0) confidence = "medium";
    else confidence = "low";

    return {
      pointForecast: Math.round(point),
      upperForecast: Math.round(upper),
      method: "holt-winters",
      confidence,
      insufficientData: false,
    };
  } catch {
    const recent = sumLast(series, 7);
    const dailyAvg = recent / 7;
    const point = dailyAvg * horizonDays;
    return {
      pointForecast: Math.max(0, Math.round(point)),
      upperForecast: Math.max(0, Math.round(point * 1.3)),
      method: "fallback-moving-average",
      confidence: "low",
      insufficientData: true,
    };
  }
}

function summarize(rows: CapacityForecastRow[]) {
  let totalCapacity = 0;
  let totalCurrentlyInUse = 0;
  let totalPredictedInflow = 0;
  let totalPredictedInflowUpper = 0;
  let wardsAtRisk = 0;
  for (const r of rows) {
    totalCapacity += r.capacityUnits;
    totalCurrentlyInUse += r.currentlyInUse;
    totalPredictedInflow += r.predictedInflow;
    totalPredictedInflowUpper += r.predictedInflowUpper;
    if (r.expectedStockout) wardsAtRisk++;
  }
  const aggregateOccupancyPct =
    totalCapacity > 0
      ? Math.round(
          ((totalCurrentlyInUse + totalPredictedInflow) / totalCapacity) * 1000
        ) / 10
      : 0;
  return {
    totalCapacity,
    totalCurrentlyInUse,
    totalPredictedInflow,
    totalPredictedInflowUpper,
    aggregateOccupancyPct,
    anyStockoutRisk: wardsAtRisk > 0,
    wardsAtRisk,
  };
}

function horizonDaysFor(h: CapacityHorizonHours): number {
  return Math.max(1, Math.round(h / 24));
}

// ── Shared ward-based forecaster (beds + ICU) ─────────────────────────────────

interface WardForecastOpts {
  horizonHours: CapacityHorizonHours;
  wardTypes?: string[]; // undefined = all types
  now?: Date;
}

async function forecastWards(
  opts: WardForecastOpts
): Promise<CapacityForecastResponse> {
  const now = opts.now ?? new Date();
  const horizonHours = opts.horizonHours;
  const horizonDays = horizonDaysFor(horizonHours);
  const historyStart = new Date(now);
  historyStart.setDate(historyStart.getDate() - HISTORY_DAYS);
  const horizonEnd = new Date(now.getTime() + horizonHours * 60 * 60 * 1000);

  const wardFilter = opts.wardTypes
    ? { type: { in: opts.wardTypes as any[] } }
    : {};

  const wards = await (prisma as any).ward.findMany({
    where: wardFilter,
    include: {
      beds: { select: { id: true, status: true } },
    },
  });

  const rows: CapacityForecastRow[] = [];

  for (const w of wards) {
    const bedIds: string[] = w.beds.map((b: any) => b.id);
    const capacityUnits = bedIds.length;
    if (capacityUnits === 0) continue;

    // Current occupancy = active (non-discharged) admissions on this ward
    const currentlyInUse = await (prisma as any).admission.count({
      where: {
        bedId: { in: bedIds },
        status: "ADMITTED",
      },
    });

    // Planned discharges during horizon: admissions whose expectedLosDays land
    // within the horizon window. Since we only have admittedAt + expectedLosDays
    // we compute (admittedAt + expectedLosDays) and count those before horizonEnd.
    const activeAdmissions = await (prisma as any).admission.findMany({
      where: {
        bedId: { in: bedIds },
        status: "ADMITTED",
      },
      select: { admittedAt: true, expectedLosDays: true },
    });
    let plannedReleases = 0;
    for (const a of activeAdmissions) {
      const los = typeof a.expectedLosDays === "number" ? a.expectedLosDays : null;
      if (los == null) continue;
      const expectedDischarge = new Date(a.admittedAt);
      expectedDischarge.setDate(expectedDischarge.getDate() + los);
      if (expectedDischarge >= now && expectedDischarge <= horizonEnd) {
        plannedReleases++;
      }
    }

    // Historical admission inflow series for this ward
    const history = await (prisma as any).admission.findMany({
      where: {
        bedId: { in: bedIds },
        admittedAt: { gte: historyStart, lte: now },
      },
      select: { admittedAt: true },
    });
    const series = buildDailyCountSeries(
      history.map((h: any) => ({ at: h.admittedAt })),
      HISTORY_DAYS,
      now
    );

    const trimmedSeries =
      history.length === 0
        ? series.slice(-Math.min(series.length, 7)) // force fallback branch
        : series;

    const fc = forecastInflow(trimmedSeries, horizonDays);

    const netOccupancy =
      currentlyInUse - plannedReleases + fc.pointForecast;
    const expectedOccupancyPct =
      capacityUnits > 0
        ? Math.round((netOccupancy / capacityUnits) * 1000) / 10
        : 0;

    const freeCapacity =
      capacityUnits - currentlyInUse + plannedReleases;
    const expectedStockout = fc.upperForecast > freeCapacity;

    rows.push({
      resourceId: w.id,
      resourceName: w.name,
      resourceType: "ward",
      capacityUnits,
      currentlyInUse,
      plannedReleases,
      predictedInflow: fc.pointForecast,
      predictedInflowUpper: fc.upperForecast,
      expectedOccupancyPct,
      expectedStockout,
      confidence: fc.confidence,
      method: fc.method,
      insufficientData: fc.insufficientData,
    });
  }

  return {
    horizonHours,
    generatedAt: now.toISOString(),
    forecasts: rows,
    summary: summarize(rows),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function forecastBedOccupancy(input: {
  horizonHours: CapacityHorizonHours;
  now?: Date;
}): Promise<CapacityForecastResponse> {
  return forecastWards({
    horizonHours: input.horizonHours,
    // Beds across all ward types except pure-ICU ones (captured separately).
    wardTypes: [
      "GENERAL",
      "PRIVATE",
      "SEMI_PRIVATE",
      "HDU",
      "EMERGENCY",
      "MATERNITY",
    ],
    now: input.now,
  });
}

export async function forecastICUDemand(input: {
  horizonHours: CapacityHorizonHours;
  now?: Date;
}): Promise<CapacityForecastResponse> {
  return forecastWards({
    horizonHours: input.horizonHours,
    wardTypes: ["ICU", "NICU"],
    now: input.now,
  });
}

/**
 * OT / surgery utilisation forecast.
 *
 * Capacity for an OT over `horizonHours` is modelled as the theoretical
 * maximum slots at a 4-hour average case length — e.g. 72h → 18 slots per
 * theatre.  Current load = already-scheduled surgeries in the window.
 * Inflow forecast = Holt-Winters on the daily scheduled-case count.
 */
export async function forecastOTUtilization(input: {
  horizonHours: CapacityHorizonHours;
  now?: Date;
}): Promise<CapacityForecastResponse> {
  const now = input.now ?? new Date();
  const horizonHours = input.horizonHours;
  const horizonDays = horizonDaysFor(horizonHours);
  const historyStart = new Date(now);
  historyStart.setDate(historyStart.getDate() - HISTORY_DAYS);
  const horizonEnd = new Date(now.getTime() + horizonHours * 60 * 60 * 1000);

  // OperatingTheater is not tenant-scoped in the schema but Surgery is.
  const { prisma: rawPrisma } = await import("@medcore/db");
  const ots = await (rawPrisma as any).operatingTheater.findMany({
    where: { isActive: true },
  });

  const rows: CapacityForecastRow[] = [];
  const avgCaseHours = 4;
  const slotsPerHorizon = Math.max(1, Math.floor(horizonHours / avgCaseHours));

  for (const ot of ots) {
    const capacityUnits = slotsPerHorizon;

    // Already-scheduled surgeries in the horizon
    const scheduledInHorizon = await (prisma as any).surgery.count({
      where: {
        otId: ot.id,
        scheduledAt: { gte: now, lte: horizonEnd },
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      },
    });

    // In-progress surgeries right now count toward currentlyInUse
    const currentlyInUse = await (prisma as any).surgery.count({
      where: {
        otId: ot.id,
        status: "IN_PROGRESS",
      },
    });

    const history = await (prisma as any).surgery.findMany({
      where: {
        otId: ot.id,
        scheduledAt: { gte: historyStart, lte: now },
      },
      select: { scheduledAt: true },
    });
    const series = buildDailyCountSeries(
      history.map((h: any) => ({ at: h.scheduledAt })),
      HISTORY_DAYS,
      now
    );

    const fc = forecastInflow(series, horizonDays);

    // Total expected load = already-scheduled + forecast of further bookings
    const totalLoad = scheduledInHorizon + fc.pointForecast;
    const expectedOccupancyPct =
      capacityUnits > 0
        ? Math.round((totalLoad / capacityUnits) * 1000) / 10
        : 0;
    const expectedStockout =
      scheduledInHorizon + fc.upperForecast > capacityUnits;

    rows.push({
      resourceId: ot.id,
      resourceName: ot.name,
      resourceType: "ot",
      capacityUnits,
      currentlyInUse,
      plannedReleases: scheduledInHorizon, // re-used field: OT booked slots
      predictedInflow: fc.pointForecast,
      predictedInflowUpper: fc.upperForecast,
      expectedOccupancyPct,
      expectedStockout,
      confidence: fc.confidence,
      method: fc.method,
      insufficientData: fc.insufficientData,
    });
  }

  return {
    horizonHours,
    generatedAt: now.toISOString(),
    forecasts: rows,
    summary: summarize(rows),
  };
}
