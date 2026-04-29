/**
 * Issue #348 — bed counts were inconsistent across the Wards, Admissions and
 * Dashboard pages because each computed totals slightly differently:
 *
 *   • Wards page:        prefer w.availableBeds, else recompute from beds[]
 *   • Admissions page:   only use beds[] (ignored availableBeds entirely)
 *   • Dashboard:         total = beds.length || totalBeds, occupied only
 *                        from beds[] (no fallback)
 *
 * When `/wards` returns the modern shape `{ totalBeds, availableBeds, ..., beds }`
 * all three branches happen to agree. But on payloads where `beds` is omitted
 * (e.g. cached responses, e2e fixtures, tenant-scoped reads where the include
 * is dropped) the three formulas produced different numbers.
 *
 * `summarizeBeds` collapses every fallback into one formula, and
 * `getBedSummary` produces the same `{ total, available, occupied, cleaning,
 * maintenance }` shape from the `/wards` response so every page uses the
 * exact same numbers.
 */

interface BedLike {
  status?: string | null;
}

interface WardLike {
  beds?: BedLike[] | null;
  totalBeds?: number | null;
  availableBeds?: number | null;
  occupiedBeds?: number | null;
  cleaningBeds?: number | null;
  maintenanceBeds?: number | null;
}

export interface BedSummary {
  total: number;
  available: number;
  occupied: number;
  cleaning: number;
  maintenance: number;
}

const ZERO: BedSummary = {
  total: 0,
  available: 0,
  occupied: 0,
  cleaning: 0,
  maintenance: 0,
};

export function summarizeBeds(ward: WardLike | null | undefined): BedSummary {
  if (!ward) return { ...ZERO };
  const beds = Array.isArray(ward.beds) ? ward.beds : [];
  const fromBeds = beds.length > 0;
  const count = (s: string) =>
    beds.filter((b) => b?.status === s).length;
  return {
    total: fromBeds ? beds.length : Number(ward.totalBeds ?? 0),
    available: fromBeds ? count("AVAILABLE") : Number(ward.availableBeds ?? 0),
    occupied: fromBeds ? count("OCCUPIED") : Number(ward.occupiedBeds ?? 0),
    cleaning: fromBeds ? count("CLEANING") : Number(ward.cleaningBeds ?? 0),
    maintenance: fromBeds
      ? count("MAINTENANCE")
      : Number(ward.maintenanceBeds ?? 0),
  };
}

export function getBedSummary(
  wards: WardLike[] | null | undefined
): BedSummary {
  const list = Array.isArray(wards) ? wards : [];
  return list.reduce<BedSummary>((acc, w) => {
    const s = summarizeBeds(w);
    return {
      total: acc.total + s.total,
      available: acc.available + s.available,
      occupied: acc.occupied + s.occupied,
      cleaning: acc.cleaning + s.cleaning,
      maintenance: acc.maintenance + s.maintenance,
    };
  }, { ...ZERO });
}
