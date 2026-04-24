"use client";

/**
 * Patient Data Export — DPDP Act 2023 right-to-portability (web).
 *
 * PATIENT-only dashboard screen that mirrors the mobile `ai/data-export`
 * route. Lets the caller pick a format (JSON / FHIR / PDF), queues an
 * export request, polls every 5 s while QUEUED/PROCESSING, and surfaces a
 * signed download link once READY. Staff roles get a polite "forbidden"
 * message — the endpoint is authorise'd to PATIENT only.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { useTranslation } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import {
  Download,
  FileJson,
  FileText,
  ShieldCheck,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";

type ExportFormat = "json" | "fhir" | "pdf";
type ExportStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED";

interface ExportRow {
  requestId: string;
  format: ExportFormat;
  status: ExportStatus;
  requestedAt: string;
  readyAt: string | null;
  errorMessage: string | null;
  fileSize: number | null;
  downloadUrl: string | null;
  downloadTtlSeconds: number | null;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
const ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, "");

export default function PatientDataExportPage() {
  const router = useRouter();
  const { user, isLoading } = useAuthStore();
  const { t } = useTranslation();

  const [format, setFormat] = useState<ExportFormat>("json");
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // PATIENT-only page. Non-patient roles get bounced to the dashboard with
  // a toast — the API will already refuse them, but a clean UX saves a
  // roundtrip.
  useEffect(() => {
    if (isLoading || !user) return;
    if (user.role !== "PATIENT") {
      toast.error(
        t(
          "dataExport.forbidden",
          "This page is only available to patients."
        )
      );
      router.push("/dashboard");
    }
  }, [isLoading, user, router, t]);

  const refresh = useCallback(async () => {
    // No list endpoint — refresh each known row's status.
    const next = await Promise.all(
      rows.map(async (row) => {
        try {
          const res = await api.get<{ data: ExportRow }>(
            `/patient-data-export/${row.requestId}`
          );
          return res.data;
        } catch {
          return row;
        }
      })
    );
    setRows(next);
  }, [rows]);

  // Poll every 5 s while any export is still queued/processing.
  useEffect(() => {
    const active = rows.some(
      (r) => r.status === "QUEUED" || r.status === "PROCESSING"
    );
    if (!active) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [rows, refresh]);

  async function handleRequest() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<{
        data: {
          requestId: string;
          format: ExportFormat;
          status: ExportStatus;
        };
      }>("/patient-data-export", { format });
      const created: ExportRow = {
        requestId: res.data.requestId,
        format: res.data.format,
        status: res.data.status,
        requestedAt: new Date().toISOString(),
        readyAt: null,
        errorMessage: null,
        fileSize: null,
        downloadUrl: null,
        downloadTtlSeconds: null,
      };
      setRows((prev) => [created, ...prev]);
      toast.success(
        t("dataExport.queued", "Export queued. We'll email you when it's ready.")
      );
    } catch (err: any) {
      if (err?.status === 429) {
        const msg = t(
          "dataExport.rateLimited",
          "You have reached the daily limit of 3 exports. Try again in 24 hours."
        );
        setError(msg);
        toast.error(msg);
      } else {
        const msg = err?.message || t("dataExport.error", "Export request failed.");
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function absoluteDownloadUrl(relative: string): string {
    if (relative.startsWith("http")) return relative;
    return `${ORIGIN}${relative}`;
  }

  const statusChip = (s: ExportStatus): React.ReactElement => {
    const labelByStatus: Record<ExportStatus, string> = {
      QUEUED: t("dataExport.status.queued", "Queued"),
      PROCESSING: t("dataExport.status.processing", "Processing"),
      READY: t("dataExport.status.ready", "Ready"),
      FAILED: t("dataExport.status.failed", "Failed"),
    };
    const icon =
      s === "READY" ? (
        <CheckCircle2 size={14} />
      ) : s === "FAILED" ? (
        <AlertCircle size={14} />
      ) : (
        <Clock size={14} />
      );
    const cls =
      s === "READY"
        ? "bg-green-100 text-green-800"
        : s === "FAILED"
          ? "bg-red-100 text-red-800"
          : "bg-blue-100 text-blue-800";
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
      >
        {icon}
        {labelByStatus[s]}
      </span>
    );
  };

  // Render a "not yet signed in" placeholder while the auth store hydrates.
  if (isLoading || !user || user.role !== "PATIENT") {
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-2">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          <ShieldCheck size={22} className="text-primary" aria-hidden />
          {t("dataExport.title", "Download My Data")}
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t(
            "dataExport.subtitle",
            "DPDP Act 2023 — Right to Data Portability"
          )}
        </p>
      </header>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        {t(
          "dataExport.disclaimer",
          "We will package everything this hospital holds about you. Exports may take a few minutes. Download links are signed and valid for 1 hour."
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("dataExport.pickFormat", "Choose a format")}
        </h2>
        <div className="grid gap-2">
          {(
            [
              {
                key: "json",
                icon: <FileJson size={18} />,
                label: t("dataExport.fmt.json", "JSON — full record"),
                hint: t(
                  "dataExport.fmt.jsonHint",
                  "Best for importing into another system"
                ),
              },
              {
                key: "fhir",
                icon: <FileJson size={18} />,
                label: t("dataExport.fmt.fhir", "FHIR R4 bundle"),
                hint: t(
                  "dataExport.fmt.fhirHint",
                  "Interoperable with ABDM and other EHRs"
                ),
              },
              {
                key: "pdf",
                icon: <FileText size={18} />,
                label: t("dataExport.fmt.pdf", "PDF summary"),
                hint: t(
                  "dataExport.fmt.pdfHint",
                  "Human-readable summary — not a clinical document"
                ),
              },
            ] as Array<{
              key: ExportFormat;
              icon: React.ReactElement;
              label: string;
              hint: string;
            }>
          ).map((opt) => {
            const selected = format === opt.key;
            return (
              <label
                key={opt.key}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-gray-200 hover:border-gray-300 dark:border-gray-700"
                }`}
              >
                <input
                  type="radio"
                  name="format"
                  value={opt.key}
                  checked={selected}
                  onChange={() => setFormat(opt.key)}
                  className="mt-1"
                />
                <span className="text-gray-700 dark:text-gray-300">
                  {opt.icon}
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {opt.label}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {opt.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleRequest}
          disabled={submitting}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Download size={16} />
          )}
          {submitting
            ? t("dataExport.requesting", "Requesting...")
            : t("dataExport.requestBtn", "Request export")}
        </button>
        {error ? (
          <p className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>
        ) : null}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("dataExport.pastExports", "Past exports")}
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm italic text-gray-500 dark:text-gray-400">
            {t("dataExport.noPast", "No exports yet.")}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {rows.map((row) => (
              <li
                key={row.requestId}
                className="flex items-center gap-3 py-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold uppercase text-gray-900 dark:text-gray-100">
                      {row.format}
                    </span>
                    {statusChip(row.status)}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(row.requestedAt).toLocaleString()}
                  </p>
                  {row.errorMessage ? (
                    <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                      {row.errorMessage}
                    </p>
                  ) : null}
                </div>
                {row.status === "READY" && row.downloadUrl ? (
                  <a
                    href={absoluteDownloadUrl(row.downloadUrl)}
                    className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                    download
                  >
                    <Download size={14} />
                    {t("dataExport.download", "Download")}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
