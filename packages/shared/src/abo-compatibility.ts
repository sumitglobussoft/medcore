/**
 * ABO + Rh blood-group compatibility helpers (Issue #93, 2026-04-26).
 *
 * Source of truth for the cross-match warnings shown in the blood-bank
 * "issue units" UI and the validation gate the API uses to reject
 * incompatible RBC issues. The matrix is mirrored from the inline
 * `RBC_COMPATIBILITY` map that previously lived only in
 * `apps/api/src/routes/bloodbank.ts` so a single edit here updates both
 * server and client.
 *
 * Matrix conventions:
 *  - Keys are RECIPIENT blood groups.
 *  - Values are arrays of donor blood groups whose RBCs may be transfused
 *    to that recipient. AB+ is universal recipient; O- is universal donor.
 *  - Plasma compatibility flips the direction (ABO antibodies are in the
 *    plasma of the donor unit) so it has its own table.
 */

export type AboBloodGroup =
  | "A_POS"
  | "A_NEG"
  | "B_POS"
  | "B_NEG"
  | "AB_POS"
  | "AB_NEG"
  | "O_POS"
  | "O_NEG";

export const ALL_BLOOD_GROUPS: ReadonlyArray<AboBloodGroup> = [
  "A_POS",
  "A_NEG",
  "B_POS",
  "B_NEG",
  "AB_POS",
  "AB_NEG",
  "O_POS",
  "O_NEG",
];

/** RBC compat: recipient → list of donor groups whose red cells are safe. */
export const RBC_COMPATIBILITY: Record<AboBloodGroup, AboBloodGroup[]> = {
  A_POS: ["A_POS", "A_NEG", "O_POS", "O_NEG"],
  A_NEG: ["A_NEG", "O_NEG"],
  B_POS: ["B_POS", "B_NEG", "O_POS", "O_NEG"],
  B_NEG: ["B_NEG", "O_NEG"],
  AB_POS: [
    "A_POS",
    "A_NEG",
    "B_POS",
    "B_NEG",
    "AB_POS",
    "AB_NEG",
    "O_POS",
    "O_NEG",
  ],
  AB_NEG: ["A_NEG", "B_NEG", "AB_NEG", "O_NEG"],
  O_POS: ["O_POS", "O_NEG"],
  O_NEG: ["O_NEG"],
};

/** Plasma compat: recipient → donor groups whose plasma is safe. */
export const PLASMA_COMPATIBILITY: Record<AboBloodGroup, AboBloodGroup[]> = {
  A_POS: ["A_POS", "A_NEG", "AB_POS", "AB_NEG"],
  A_NEG: ["A_POS", "A_NEG", "AB_POS", "AB_NEG"],
  B_POS: ["B_POS", "B_NEG", "AB_POS", "AB_NEG"],
  B_NEG: ["B_POS", "B_NEG", "AB_POS", "AB_NEG"],
  AB_POS: ["AB_POS", "AB_NEG"],
  AB_NEG: ["AB_POS", "AB_NEG"],
  O_POS: [
    "O_POS",
    "O_NEG",
    "A_POS",
    "A_NEG",
    "B_POS",
    "B_NEG",
    "AB_POS",
    "AB_NEG",
  ],
  O_NEG: [
    "O_POS",
    "O_NEG",
    "A_POS",
    "A_NEG",
    "B_POS",
    "B_NEG",
    "AB_POS",
    "AB_NEG",
  ],
};

function isAboBloodGroup(s: string | null | undefined): s is AboBloodGroup {
  return !!s && (ALL_BLOOD_GROUPS as ReadonlyArray<string>).includes(s);
}

/**
 * Returns true iff a unit of `donor` RBC may be transfused into `recipient`.
 * Defaults to false (fail-safe) on unknown groups so the UI/API will warn
 * rather than silently allow a mismatch.
 */
export function isAboCompatible(
  donor: string | null | undefined,
  recipient: string | null | undefined,
  productType: "RBC" | "PLASMA" = "RBC"
): boolean {
  if (!isAboBloodGroup(donor) || !isAboBloodGroup(recipient)) return false;
  const matrix =
    productType === "PLASMA" ? PLASMA_COMPATIBILITY : RBC_COMPATIBILITY;
  return matrix[recipient].includes(donor);
}

/** Pretty-print a blood group for warning banners (e.g. "A_POS" → "A+"). */
export function prettyBloodGroup(g: string): string {
  return g.replace("_POS", "+").replace("_NEG", "-").replace("_", " ");
}

/**
 * Builds a human-readable mismatch reason for the override banner.
 * Returns null when compatible (no warning needed).
 */
export function aboMismatchReason(
  donor: string | null | undefined,
  recipient: string | null | undefined,
  productType: "RBC" | "PLASMA" = "RBC"
): string | null {
  if (isAboCompatible(donor, recipient, productType)) return null;
  if (!isAboBloodGroup(donor) || !isAboBloodGroup(recipient)) {
    return `Unknown blood group(s): donor=${donor ?? "?"} recipient=${recipient ?? "?"}`;
  }
  return `${productType} mismatch: ${prettyBloodGroup(donor)} unit cannot be issued to ${prettyBloodGroup(recipient)} recipient`;
}
