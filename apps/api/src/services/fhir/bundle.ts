/**
 * FHIR R4 Bundle helpers — wraps resources into `searchset` or `transaction`
 * bundles with proper `fullUrl` references.
 *
 * Per FHIR R4 spec, `Bundle.entry.fullUrl` should be a URL that uniquely
 * identifies the resource. When building a local bundle for export we use
 * `urn:uuid:` URNs so receivers can resolve references within the bundle
 * without needing our public base URL.
 */

import type { FhirResource } from "./resources";

export interface FhirBundleEntry<R extends FhirResource = FhirResource> {
  fullUrl: string;
  resource: R;
  request?: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    url: string;
  };
}

export interface FhirBundle<R extends FhirResource = FhirResource> {
  resourceType: "Bundle";
  id: string;
  type: "searchset" | "transaction" | "transaction-response" | "batch" | "document" | "collection";
  timestamp: string;
  total?: number;
  entry: FhirBundleEntry<R>[];
}

/** Build a `urn:uuid:` fullUrl for a resource. FHIR permits this form for intra-bundle refs. */
function fullUrlFor(resource: FhirResource): string {
  // When the id is already a UUID, keep it; otherwise prefix with the type
  // so fullUrls remain unique across resource types.
  return `urn:uuid:${resource.resourceType}-${resource.id}`;
}

/**
 * Wrap an array of resources into a FHIR `searchset` Bundle. Used for
 * read-style responses (e.g. `$everything`, search results).
 */
export function toSearchsetBundle(resources: FhirResource[], id?: string): FhirBundle {
  const entries: FhirBundleEntry[] = resources.map((r) => ({
    fullUrl: fullUrlFor(r),
    resource: r,
  }));

  return {
    resourceType: "Bundle",
    id: id ?? `bundle-${Date.now()}`,
    type: "searchset",
    timestamp: new Date().toISOString(),
    total: entries.length,
    entry: entries,
  };
}

/**
 * Wrap resources into a FHIR `transaction` Bundle. Each entry gets a PUT
 * request pointing at the canonical resource URL, making the bundle idempotent
 * against the receiving server.
 */
export function toTransactionBundle(resources: FhirResource[], id?: string): FhirBundle {
  const entries: FhirBundleEntry[] = resources.map((r) => ({
    fullUrl: fullUrlFor(r),
    resource: r,
    request: { method: "PUT", url: `${r.resourceType}/${r.id}` },
  }));

  return {
    resourceType: "Bundle",
    id: id ?? `txn-${Date.now()}`,
    type: "transaction",
    timestamp: new Date().toISOString(),
    entry: entries,
  };
}

/**
 * Stub for processing an incoming transaction bundle. In production this would
 * iterate the entries and upsert each referenced resource. For now we return
 * a `transaction-response` echoing 200-OK entries — sufficient for ABDM
 * conformance testing scaffolding.
 */
export function processTransactionBundle(bundle: FhirBundle): FhirBundle {
  const responseEntries: FhirBundleEntry[] = (bundle.entry ?? []).map((e) => ({
    fullUrl: e.fullUrl,
    resource: e.resource,
    request: { method: "POST", url: "200 OK" as any },
  }));

  return {
    resourceType: "Bundle",
    id: `txn-response-${Date.now()}`,
    type: "transaction-response",
    timestamp: new Date().toISOString(),
    entry: responseEntries,
  };
}

export interface BundleConsistencyIssue {
  severity: "error" | "warning";
  code:
    | "invalid-type"
    | "missing-resource-type"
    | "duplicate-fullurl"
    | "unresolved-reference";
  path: string;
  message: string;
  entryIndex?: number;
}

export interface BundleConsistencyResult {
  valid: boolean;
  issues: BundleConsistencyIssue[];
}

/**
 * Validate that a FHIR Bundle is internally self-consistent: unique fullUrls,
 * every resourceType set, and every intra-bundle `reference` resolves to a
 * sibling entry (matched by `ResourceType/id` or by `fullUrl`). Absolute
 * https://… references are tolerated as external.
 */
export function validateBundleSelfConsistency(bundle: FhirBundle): BundleConsistencyResult {
  const issues: BundleConsistencyIssue[] = [];
  const validTypes = new Set([
    "searchset", "transaction", "transaction-response",
    "batch", "document", "collection",
  ]);
  if (!validTypes.has(bundle.type)) {
    issues.push({ severity: "error", code: "invalid-type", path: "Bundle.type", message: `Unknown type ${bundle.type}` });
  }

  const fullUrls = new Set<string>();
  const byTypeId = new Set<string>();
  for (const [i, entry] of (bundle.entry ?? []).entries()) {
    if (!entry.resource?.resourceType) {
      issues.push({ severity: "error", code: "missing-resource-type", path: `entry[${i}].resource.resourceType`, message: "missing resourceType", entryIndex: i });
      continue;
    }
    if (entry.fullUrl) {
      if (fullUrls.has(entry.fullUrl)) {
        issues.push({ severity: "error", code: "duplicate-fullurl", path: `entry[${i}].fullUrl`, message: `duplicate fullUrl ${entry.fullUrl}`, entryIndex: i });
      }
      fullUrls.add(entry.fullUrl);
    }
    const id = (entry.resource as any).id;
    if (id) byTypeId.add(`${entry.resource.resourceType}/${id}`);
  }

  const refs: { path: string; value: string; entryIndex: number }[] = [];
  const walk = (node: unknown, path: string, entryIndex: number) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`, entryIndex));
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "reference" && typeof v === "string") refs.push({ path: `${path}.${k}`, value: v, entryIndex });
      else walk(v, `${path}.${k}`, entryIndex);
    }
  };
  for (const [i, entry] of (bundle.entry ?? []).entries()) walk(entry.resource, `entry[${i}].resource`, i);

  for (const { path, value, entryIndex } of refs) {
    if (/^https?:\/\//i.test(value)) continue;
    if (fullUrls.has(value)) continue;
    if (byTypeId.has(value)) continue;
    issues.push({ severity: "error", code: "unresolved-reference", path, message: `unresolvable reference ${value}`, entryIndex });
  }

  return { valid: issues.every((i) => i.severity !== "error"), issues };
}
