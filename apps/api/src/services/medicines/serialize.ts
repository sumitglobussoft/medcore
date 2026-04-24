/**
 * Serializer for Medicine DB rows → API response shape.
 *
 * The frontend (apps/web/src/app/dashboard/medicines) expects two fields that
 * don't literally exist on the DB row:
 *   - `rxRequired`   ← alias of `prescriptionRequired`
 *   - `manufacturer` ← alias of `brand` (Indian pharma convention: the brand
 *                      IS the manufacturer's product identity)
 *
 * We intentionally expose BOTH the raw columns and the aliased fields so:
 *   - Existing callers that query `prescriptionRequired` / `brand` keep working
 *   - The medicines list view renders "Rx Required: Yes" and the manufacturer
 *     name without needing a schema migration.
 *
 * The schema.prisma is locked (cross-cutting concern — many models reference
 * `brand`), so aliasing at the API boundary is the pragmatic fix.
 */

type MedicineLike = Record<string, unknown> & {
  prescriptionRequired?: boolean | null;
  brand?: string | null;
};

export interface SerializedMedicine extends Record<string, unknown> {
  rxRequired: boolean;
  manufacturer: string | null;
}

export function serializeMedicine<T extends MedicineLike>(
  m: T
): T & SerializedMedicine {
  return {
    ...m,
    rxRequired: m.prescriptionRequired ?? true,
    manufacturer: m.brand ?? null,
  };
}

export function serializeMedicines<T extends MedicineLike>(
  list: T[]
): (T & SerializedMedicine)[] {
  return list.map(serializeMedicine);
}
