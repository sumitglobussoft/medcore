/**
 * scripts/rename-audit-actions.ts
 *
 * Normalizes audit log action names in auditLog(req, "ACTION", ...) calls
 * across apps/api/src/**\/*.ts per the 2026-04-23 audit naming rules:
 *
 * Shape:   <ENTITY>_<VERB>
 * Tense:   imperative, NOT past (exception: true events that happened TO the user,
 *          not actions performed BY the user).
 * Verbs:   preferred whitelist CREATE | UPDATE | DELETE | READ | LIST | CANCEL |
 *          APPROVE | REJECT | ASSIGN | TRANSFER | EXPORT | IMPORT | RECONCILE,
 *          plus composite/domain-specific verbs where they read more naturally
 *          (e.g. LWBS_MARK, SESSION_START, CHECK_IN).
 *
 * Usage:   npx tsx scripts/rename-audit-actions.ts [--dry]
 *
 * Safe-rewrite rule: only exact-match string literals of the form
 *   auditLog(req, "<OLD>", ...)
 * are rewritten. Other occurrences of the same literal (comments, DB queries,
 * unrelated code) are left untouched unless they appear inside an auditLog call.
 *
 * The 21+ action names already normalized in commit c1c3cd7 are absent from
 * RENAMES below, so they will not be touched on a rerun.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Old -> New. Keys are ONLY the actions that need renaming. Anything not
// listed here is already in canonical form and left alone.
const RENAMES: Record<string, string> = {
  // -- auth / session -----------------------------------------------------
  LOGIN: "AUTH_LOGIN",
  LOGOUT: "AUTH_LOGOUT",
  LOGOUT_ALL_SESSIONS: "AUTH_LOGOUT_ALL",
  REGISTER: "USER_REGISTER",

  // -- ABDM (external flow; keep imperative where it's a user action) -----
  ABDM_ABHA_LINK_INITIATED: "ABDM_ABHA_LINK_CREATE",
  ABDM_ABHA_DELINKED: "ABDM_ABHA_LINK_DELETE",
  ABDM_ABHA_VERIFIED: "ABDM_ABHA_VERIFY",
  ABDM_CARE_CONTEXT_LINKED: "ABDM_CARE_CONTEXT_LINK",
  ABDM_CONSENTS_LISTED: "ABDM_CONSENT_LIST",
  ABDM_CONSENT_READ_LOCAL: "ABDM_CONSENT_READ",
  ABDM_CONSENT_REQUESTED: "ABDM_CONSENT_REQUEST",
  ABDM_CONSENT_REVOKED: "ABDM_CONSENT_REVOKE",
  ABDM_CONSENT_VIEWED: "ABDM_CONSENT_VIEW",

  // -- ANC / maternal -----------------------------------------------------
  ADD_ANC_VISIT: "ANC_VISIT_CREATE",
  CREATE_ANC_CASE: "ANC_CASE_CREATE",
  UPDATE_ANC_CASE: "ANC_CASE_UPDATE",

  // -- blood bank ---------------------------------------------------------
  ADD_DONOR_DEFERRAL: "BLOOD_DONOR_DEFERRAL_CREATE",
  CREATE_BLOOD_DONATION: "BLOOD_DONATION_CREATE",
  CREATE_BLOOD_DONOR: "BLOOD_DONOR_CREATE",
  CREATE_BLOOD_REQUEST: "BLOOD_REQUEST_CREATE",
  CREATE_BLOOD_UNIT: "BLOOD_UNIT_CREATE",
  ISSUE_BLOOD_UNITS: "BLOOD_UNIT_ISSUE",
  RECORD_BLOOD_SCREENING: "BLOOD_SCREENING_CREATE",
  RECORD_CROSS_MATCH: "BLOOD_CROSS_MATCH_CREATE",
  RELEASE_BLOOD_UNIT_RESERVATION: "BLOOD_UNIT_RESERVATION_RELEASE",
  RELEASE_EXPIRED_RESERVATIONS: "BLOOD_RESERVATION_EXPIRE",
  RESERVE_BLOOD_UNIT: "BLOOD_UNIT_RESERVE",
  SEND_DONATION_REMINDERS: "BLOOD_DONATION_REMINDER_SEND",
  SEPARATE_COMPONENTS: "BLOOD_COMPONENT_SEPARATE",
  UPDATE_BLOOD_DONOR: "BLOOD_DONOR_UPDATE",

  // -- inventory / pharmacy stock ----------------------------------------
  ADD_INVENTORY: "INVENTORY_CREATE",
  UPDATE_INVENTORY: "INVENTORY_UPDATE",
  RECALL_INVENTORY_BATCH: "INVENTORY_BATCH_RECALL",
  STOCK_ADJUSTMENT: "STOCK_ADJUST",
  CREATE_MEDICINE: "MEDICINE_CREATE",
  UPDATE_MEDICINE: "MEDICINE_UPDATE",

  // -- invoices / billing -------------------------------------------------
  ADD_INVOICE_ITEM: "INVOICE_ITEM_CREATE",
  REMOVE_INVOICE_ITEM: "INVOICE_ITEM_DELETE",
  APPLY_DISCOUNT: "DISCOUNT_APPLY",
  APPLY_LATE_FEES: "LATE_FEE_APPLY",
  APPROVE_DISCOUNT: "DISCOUNT_APPROVE",
  REJECT_DISCOUNT: "DISCOUNT_REJECT",
  REQUEST_DISCOUNT_APPROVAL: "DISCOUNT_APPROVAL_REQUEST",
  ISSUE_CREDIT_NOTE: "CREDIT_NOTE_CREATE",
  ISSUE_REFUND: "REFUND_CREATE",
  PAY_INSTALLMENT: "INSTALLMENT_PAY",
  RECORD_PAYMENT: "PAYMENT_CREATE",
  CANCEL_PAYMENT_PLAN: "PAYMENT_PLAN_CANCEL",

  // -- appointments -------------------------------------------------------
  BOOK_APPOINTMENT: "APPOINTMENT_CREATE",
  RESCHEDULE_APPOINTMENT: "APPOINTMENT_RESCHEDULE",
  TRANSFER_APPOINTMENT: "APPOINTMENT_TRANSFER",
  CREATE_GROUP_APPOINTMENT: "GROUP_APPOINTMENT_CREATE",
  CREATE_RECURRING_APPOINTMENTS: "RECURRING_APPOINTMENT_CREATE",
  JOIN_WAITLIST: "WAITLIST_JOIN",
  CANCEL_WAITLIST: "WAITLIST_CANCEL",
  NOTIFY_WAITLIST_NEXT: "WAITLIST_NOTIFY_NEXT",

  // -- referrals / coordinated visits ------------------------------------
  CREATE_REFERRAL: "REFERRAL_CREATE",
  UPDATE_REFERRAL_STATUS: "REFERRAL_STATUS_UPDATE",
  CREATE_COORDINATED_VISIT: "COORDINATED_VISIT_CREATE",
  CANCEL_COORDINATED_VISIT: "COORDINATED_VISIT_CANCEL",

  // -- prescriptions ------------------------------------------------------
  COPY_PRESCRIPTION: "PRESCRIPTION_COPY",
  DISPENSE_PRESCRIPTION: "PRESCRIPTION_DISPENSE",
  PRINT_PRESCRIPTION: "PRESCRIPTION_PRINT",
  SHARE_PRESCRIPTION: "PRESCRIPTION_SHARE",
  REFILL_PRESCRIPTION_ITEM: "PRESCRIPTION_ITEM_REFILL",
  CREATE_RX_TEMPLATE: "RX_TEMPLATE_CREATE",
  DELETE_RX_TEMPLATE: "RX_TEMPLATE_DELETE",

  // -- lab ----------------------------------------------------------------
  CREATE_LAB_REFERENCE_RANGE: "LAB_REFERENCE_RANGE_CREATE",
  DELETE_LAB_REFERENCE_RANGE: "LAB_REFERENCE_RANGE_DELETE",
  CREATE_LAB_TEST: "LAB_TEST_CREATE",
  UPDATE_LAB_TEST: "LAB_TEST_UPDATE",
  RECORD_LAB_RESULT: "LAB_RESULT_CREATE",
  VERIFY_LAB_RESULT: "LAB_RESULT_VERIFY",
  REJECT_LAB_SAMPLE: "LAB_SAMPLE_REJECT",
  BATCH_LAB_RESULTS: "LAB_RESULT_BATCH",

  // -- admissions / beds / wards -----------------------------------------
  CREATE_BED: "BED_CREATE",
  UPDATE_BED_STATUS: "BED_STATUS_UPDATE",
  CREATE_WARD: "WARD_CREATE",
  UPDATE_ISOLATION: "ISOLATION_UPDATE",
  RECORD_IPD_VITALS: "IPD_VITALS_CREATE",
  RECORD_INTAKE_OUTPUT: "INTAKE_OUTPUT_CREATE",
  RECORD_MEDICATION_ADMIN: "MEDICATION_ADMIN_CREATE",
  CREATE_MED_RECONCILIATION: "MED_RECONCILIATION_CREATE",

  // -- OT / surgery -------------------------------------------------------
  CREATE_OT: "OT_CREATE",
  UPDATE_OT: "OT_UPDATE",
  SCHEDULE_SURGERY: "SURGERY_SCHEDULE",
  START_SURGERY: "SURGERY_START",
  COMPLETE_SURGERY: "SURGERY_COMPLETE",
  CANCEL_SURGERY: "SURGERY_CANCEL",
  UPDATE_SURGERY: "SURGERY_UPDATE",
  UPDATE_INTRAOP_TIMING: "INTRAOP_TIMING_UPDATE",
  UPDATE_PREOP_CHECKLIST: "PREOP_CHECKLIST_UPDATE",
  UPSERT_ANESTHESIA_RECORD: "ANESTHESIA_RECORD_UPSERT",
  RECORD_SURGERY_COMPLICATIONS: "SURGERY_COMPLICATION_CREATE",
  ADD_POSTOP_OBSERVATION: "POSTOP_OBSERVATION_CREATE",
  REPORT_SSI: "SSI_REPORT",

  // -- maternal / delivery -----------------------------------------------
  ADD_PARTOGRAPH_OBSERVATION: "PARTOGRAPH_OBSERVATION_CREATE",
  START_PARTOGRAPH: "PARTOGRAPH_START",
  END_PARTOGRAPH: "PARTOGRAPH_END",
  RECORD_DELIVERY: "DELIVERY_CREATE",

  // -- pediatrics ---------------------------------------------------------
  CREATE_GROWTH_RECORD: "GROWTH_RECORD_CREATE",
  UPDATE_GROWTH_RECORD: "GROWTH_RECORD_UPDATE",
  DELETE_GROWTH_RECORD: "GROWTH_RECORD_DELETE",
  CREATE_IMMUNIZATION: "IMMUNIZATION_CREATE",
  LOG_FEEDING: "FEEDING_LOG_CREATE",
  DELETE_FEEDING_LOG: "FEEDING_LOG_DELETE",
  RECORD_MILESTONE: "MILESTONE_CREATE",

  // -- emergency / trauma -------------------------------------------------
  REGISTER_EMERGENCY_CASE: "EMERGENCY_CASE_CREATE",
  ASSIGN_EMERGENCY_DOCTOR: "EMERGENCY_DOCTOR_ASSIGN",
  CLOSE_EMERGENCY_CASE: "EMERGENCY_CASE_CLOSE",
  TRIAGE_EMERGENCY_CASE: "EMERGENCY_CASE_TRIAGE",
  UPDATE_ER_ORDERS: "ER_ORDER_UPDATE",
  UPDATE_MLC: "MLC_UPDATE",
  ER_TO_ADMISSION: "ER_ADMISSION_CONVERT",

  // -- ambulance / trips --------------------------------------------------
  CREATE_AMBULANCE: "AMBULANCE_CREATE",
  UPDATE_AMBULANCE: "AMBULANCE_UPDATE",
  CREATE_AMBULANCE_TRIP: "AMBULANCE_TRIP_CREATE",
  BILL_AMBULANCE_TRIP: "AMBULANCE_TRIP_BILL",
  DISPATCH_TRIP: "TRIP_DISPATCH",
  CANCEL_TRIP: "TRIP_CANCEL",
  COMPLETE_TRIP: "TRIP_COMPLETE",
  TRIP_EN_ROUTE: "TRIP_EN_ROUTE_MARK",

  // -- assets -------------------------------------------------------------
  CREATE_ASSET: "ASSET_CREATE",
  UPDATE_ASSET: "ASSET_UPDATE",
  ASSIGN_ASSET: "ASSET_ASSIGN",
  RETURN_ASSET: "ASSET_RETURN",
  TRANSFER_ASSET: "ASSET_TRANSFER",
  DISPOSE_ASSET: "ASSET_DISPOSE",
  LOG_ASSET_MAINTENANCE: "ASSET_MAINTENANCE_LOG",
  SET_CALIBRATION_SCHEDULE: "ASSET_CALIBRATION_SCHEDULE_SET",

  // -- procurement / PO ---------------------------------------------------
  CREATE_PO: "PO_CREATE",
  UPDATE_PO: "PO_UPDATE",
  SUBMIT_PO: "PO_SUBMIT",
  APPROVE_PO: "PO_APPROVE",
  CANCEL_PO: "PO_CANCEL",
  RECEIVE_PO: "PO_RECEIVE",
  CREATE_GRN: "GRN_CREATE",
  CREATE_SUPPLIER: "SUPPLIER_CREATE",
  UPDATE_SUPPLIER: "SUPPLIER_UPDATE",

  // -- expenses / finance -------------------------------------------------
  CREATE_EXPENSE: "EXPENSE_CREATE",
  UPDATE_EXPENSE: "EXPENSE_UPDATE",
  DELETE_EXPENSE: "EXPENSE_DELETE",
  CREATE_OVERTIME: "OVERTIME_CREATE",
  UPDATE_OVERTIME: "OVERTIME_UPDATE",
  APPROVE_OVERTIME: "OVERTIME_APPROVE",
  AUTO_CALC_OVERTIME: "OVERTIME_AUTO_CALC",
  CREATE_CERTIFICATION: "CERTIFICATION_CREATE",
  DELETE_CERTIFICATION: "CERTIFICATION_DELETE",

  // -- documents / sharing ------------------------------------------------
  CREATE_DOCUMENT: "DOCUMENT_CREATE",
  CREATE_SHARE_LINK: "SHARE_LINK_CREATE",
  DOWNLOAD_FILE: "FILE_DOWNLOAD",
  UPLOAD_FILE: "FILE_UPLOAD",
  EXPORT_CCDA: "CCDA_EXPORT",

  // -- scheduled reports --------------------------------------------------
  CREATE_SCHEDULED_REPORT: "SCHEDULED_REPORT_CREATE",
  DELETE_SCHEDULED_REPORT: "SCHEDULED_REPORT_DELETE",
  RUN_SCHEDULED_REPORT: "SCHEDULED_REPORT_RUN",

  // -- patient / family / merge ------------------------------------------
  LINK_FAMILY: "FAMILY_LINK",
  UNLINK_FAMILY: "FAMILY_UNLINK",
  MERGE_PATIENT: "PATIENT_MERGE",

  // -- clinical records ---------------------------------------------------
  CREATE_ADVANCE_DIRECTIVE: "ADVANCE_DIRECTIVE_CREATE",
  CREATE_ALLERGY: "ALLERGY_CREATE",
  CREATE_CONDITION: "CONDITION_CREATE",
  CREATE_CONTROLLED_ENTRY: "CONTROLLED_ENTRY_CREATE",

  // -- insurance / claims -------------------------------------------------
  SUBMIT_CLAIM: "CLAIM_SUBMIT",
  CANCEL_CLAIM: "CLAIM_CANCEL",
  CREATE_PREAUTH: "PREAUTH_CREATE",
  UPDATE_PREAUTH_STATUS: "PREAUTH_STATUS_UPDATE",
  RECONCILE_CLAIMS: "CLAIM_RECONCILE",

  // -- packages -----------------------------------------------------------
  PURCHASE_PACKAGE: "PACKAGE_PURCHASE",

  // -- complaints ---------------------------------------------------------
  CREATE_COMPLAINT: "COMPLAINT_CREATE",
  UPDATE_COMPLAINT: "COMPLAINT_UPDATE",

  // -- telemed ------------------------------------------------------------
  SCHEDULE_TELEMEDICINE: "TELEMED_SCHEDULE",
  START_TELEMEDICINE: "TELEMED_START",
  END_TELEMEDICINE: "TELEMED_END",
  CANCEL_TELEMEDICINE: "TELEMED_CANCEL",
  RATE_TELEMEDICINE: "TELEMED_RATE",
  TELEMED_FOLLOWUP_SCHEDULED: "TELEMED_FOLLOWUP_SCHEDULE",
  TELEMED_JOIN_WAITING: "TELEMED_WAITING_JOIN",

  // -- misc bulk ----------------------------------------------------------
  BROADCAST: "NOTIFICATION_BROADCAST",

  // -- AI scribe (events -> imperatives, except true events) -------------
  AI_SCRIBE_SESSION_STARTED: "AI_SCRIBE_SESSION_START",
  AI_SCRIBE_SIGNED_OFF: "AI_SCRIBE_SIGN_OFF",
  AI_SCRIBE_CONSENT_WITHDRAWN: "AI_SCRIBE_CONSENT_WITHDRAW",

  // -- AI triage ----------------------------------------------------------
  AI_TRIAGE_APPOINTMENT_BOOKED: "AI_TRIAGE_APPOINTMENT_BOOK",
  AI_TRIAGE_EMERGENCY_DETECTED: "AI_TRIAGE_EMERGENCY_DETECT",

  // -- finance (advance is a user action) --------------------------------
  ADVANCE_APPLIED: "ADVANCE_APPLY",

  // -- 2026-04-24 straggler pass (20 remaining non-canonical names) ------
  // EHR / clinical CRUD — verb-first to entity-first, past → imperative.
  CREATE_DRUG_INTERACTION: "DRUG_INTERACTION_CREATE",
  CREATE_FAMILY_HISTORY: "FAMILY_HISTORY_CREATE",
  DELETE_ALLERGY: "ALLERGY_DELETE",
  DELETE_CONDITION: "CONDITION_DELETE",
  DELETE_DOCUMENT: "DOCUMENT_DELETE",
  DELETE_FAMILY_HISTORY: "FAMILY_HISTORY_DELETE",
  DELETE_IMMUNIZATION: "IMMUNIZATION_DELETE",
  SOFT_DELETE_ADVANCE_DIRECTIVE: "ADVANCE_DIRECTIVE_DELETE",
  UPDATE_ADVANCE_DIRECTIVE: "ADVANCE_DIRECTIVE_UPDATE",
  UPDATE_CERTIFICATION: "CERTIFICATION_UPDATE",
  UPDATE_CONDITION: "CONDITION_UPDATE",
  UPDATE_IMMUNIZATION: "IMMUNIZATION_UPDATE",
  UPDATE_MED_RECONCILIATION: "MED_RECONCILIATION_UPDATE",
  UPDATE_PATIENT: "PATIENT_UPDATE",
  UPDATE_SCHEDULED_REPORT: "SCHEDULED_REPORT_UPDATE",

  // -- visitors (match SHIFT_CHECK_IN / SHIFT_CHECK_OUT convention) ------
  CHECKIN_VISITOR: "VISITOR_CHECK_IN",
  CHECKOUT_VISITOR: "VISITOR_CHECK_OUT",

  // -- billing / pharmacy ------------------------------------------------
  BULK_PAYMENT: "PAYMENT_BULK_CREATE",
  STOCK_MOVEMENT: "STOCK_MOVE",

  // NOTE: the following are intentionally LEFT AS-IS (true events
  // or already-canonical names). The original 2026-04-23 rename map
  // doc was retired during the Apr-27 doc-cleanup; the entire old→new
  // mapping now lives in this file's `RENAMES` constant above.
  //
  // Also preserved this pass (2026-04-24):
  //   ABDM_GATEWAY_SIGNATURE_INVALID — true event (inbound signature rejected)
  //   AI_CLAIM_PENDING_DRAFTS_LIST — already <ENTITY>_<VERB>; LIST is on the
  //     whitelist and "PENDING_DRAFTS" is the meaningful entity qualifier.
};

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(p, out);
    else if (entry.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) out.push(p);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
  const dry = process.argv.includes("--dry");
  const root = path.resolve(__dirname, "..", "apps", "api", "src");
  const files = listTsFiles(root);

  let totalChanged = 0;
  let totalReplacements = 0;
  const perActionCount = new Map<string, number>();

  for (const f of files) {
    let src = fs.readFileSync(f, "utf8");
    let changed = false;
    for (const [oldName, newName] of Object.entries(RENAMES)) {
      if (oldName === newName) continue;
      // Only rewrite occurrences inside auditLog(req, "OLD", ...)
      const pattern = new RegExp(
        `(auditLog\\(\\s*req\\s*,\\s*)"${escapeRegExp(oldName)}"`,
        "g"
      );
      const before = src;
      src = src.replace(pattern, (_m, p1) => `${p1}"${newName}"`);
      if (src !== before) {
        const count = (before.match(pattern) || []).length;
        perActionCount.set(oldName, (perActionCount.get(oldName) ?? 0) + count);
        totalReplacements += count;
        changed = true;
      }
    }
    if (changed) {
      totalChanged++;
      if (!dry) fs.writeFileSync(f, src, "utf8");
    }
  }

  console.log(`Files changed: ${totalChanged}`);
  console.log(`auditLog() occurrences rewritten: ${totalReplacements}`);
  console.log(`Distinct old action names renamed: ${perActionCount.size}`);
  if (dry) console.log("(dry run — no files written)");
}

main();
