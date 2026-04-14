# MedCore — Hospital Operations Automation System

> A full-stack hospital management system covering OPD, IPD, emergency care, diagnostics, pharmacy, finance, HR, and patient engagement — built end-to-end with a modern stack.

**Live demo:** https://medcore.globusdemos.com
**Repository:** https://github.com/Globussoft-Technologies/medcore
**Current version:** v1.2.0

---

## Highlights

- **73+ web pages** across 4 major phases + 7 enhancement/deepening passes
- **350+ API endpoints** with role-based access control
- **110+ Prisma models** covering every hospital workflow
- **Real-time WebSocket** for queue & chat updates
- **Mobile app** (React Native + Expo) for patients
- **Production-ready**: PM2 auto-restart, daily DB backups, health monitoring
- **Full audit trail** + rate limiting + input sanitization
- **Complete clinical system** — OPD, IPD, ER, Surgery, ICU, Maternity, Pediatric, Telemedicine
- **Clinical safety layer** — Drug interactions, delta checks, controlled-substance register, renal dose calc, medication reconciliation
- **Complete operations** — Pharmacy (FEFO, FIFO, returns), Lab (QC, TAT alerts), Blood Bank (ABO matching, screening, component separation), Assets (depreciation), Ambulance, Visitors
- **Complete finance** — Billing with GST (CGST+SGST), EMI plans, refunds, credit notes, pre-authorization, discount approval workflow, late fees, patient pricing tiers, health packages, purchase orders with GRN, expense tracking with budgets
- **Complete HR** — Duty roster, shifts with check-in/out + LATE detection, leaves with approval + balances + calendar, holidays, payroll, overtime, certifications with expiry tracking
- **Engagement** — Feedback with NPS + sentiment, complaints with SLA countdown, internal chat with reactions + pins + mentions, visitor management with photo capture
- **UX polish** — Dark mode, WCAG AA accessibility, PWA, Hindi i18n, print layouts, keyboard shortcuts (Ctrl+K global search), toast notifications, loading skeletons

---

## Table of Contents

1. [Feature Catalog](#feature-catalog)
2. [Tech Stack](#tech-stack)
3. [Architecture & Project Structure](#architecture--project-structure)
4. [Roles & Permissions](#roles--permissions)
5. [Module Reference](#module-reference)
6. [Local Setup](#local-setup)
7. [Deployment](#deployment)
8. [Operations](#operations)
9. [Demo Accounts](#demo-accounts)
10. [Version History](#version-history)

---

## Feature Catalog

### 🏥 Outpatient / OPD

**Appointments**
- Slot-based booking with live availability
- Walk-in registration with priority flags
- Waitlist with auto-notify on cancellation
- Calendar invite download (.ics)
- First-available slot finder across all doctors
- Buffer settings between slots
- Multi-doctor coordinated visits (see 3 specialists same day)
- Reschedule with audit trail
- Recurring appointments (daily/weekly/monthly, up to 52)
- Group appointments (training sessions)
- Calendar view, list view, stats view
- CSV export, bulk operations
- No-show policy enforcement with threshold
- No-show fee auto-billing
- Conflict detection for double-booking

**Queue**
- Real-time live queue via WebSocket
- Waiting-area token display (dark theme, high contrast)
- Queue position SMS to patients
- LWBS (Left Without Being Seen) tracking
- Queue transfer between doctors
- Vulnerable-group priority boost (seniors 65+, children under 5, ANC patients)
- Estimated wait time prediction

**Consultation Workflow**
- Check-in → Vitals → Consultation → Prescription → Billing → Checkout
- Consultation duration auto-tracking
- Doctor notes + diagnosis (ICD-10 coded)

**Vitals**
- BP, temperature (°F/°C toggle), pulse, respiratory rate, SpO2, weight, height, pain scale
- Auto-calculated BMI with category
- Abnormal flags (server-side `computeVitalsFlagsWithBaseline`)
- Patient-specific baseline (not just population normal)
- Sudden change alerts (>20% deviation triggers doctor notification)
- Critical value SMS to patient
- PDF export of vitals history

**Prescriptions**
- Digital prescriptions with diagnosis, medicines, advice, follow-up
- Doctor e-signature support
- PDF generation with hospital letterhead
- Prescription templates (10 pre-seeded for common diagnoses)
- Copy-from-previous prescription
- Refill tracking per item
- Print/share tracking (WhatsApp/Email/SMS)
- **Drug interaction check on write** — blocks SEVERE/CONTRAINDICATED unless overridden
- Generic substitution suggestions with cost comparison
- Patient education leaflets (20 pre-seeded)
- Renal dosage calculator (Cockcroft-Gault)

### 🛏️ Inpatient / IPD

**Admissions**
- Admit / transfer / discharge workflow with transaction safety
- Admission types (ELECTIVE / EMERGENCY / TRANSFER / MATERNITY / DAY_CARE)
- Auto-generated admission number (IPD######)
- **Structured discharge summary** with conditionAtDischarge enum
- **Discharge-readiness checklist** (outstanding bills, pending labs, pending meds, discharge summary, follow-up, medications-on-discharge)
- **Force-discharge** guard if bills outstanding
- **Bed occupancy forecast** (next 7 days)
- **Length-of-stay prediction** based on historical data
- **Isolation status tracking** (CONTACT / DROPLET / AIRBORNE / REVERSE)
- **Patient belongings inventory**
- **Daily census report** (admits, discharges, transfers, deaths)
- Running daily bill with bed charges

**IPD Clinical**
- IPD vitals (continuous monitoring)
- Medication orders with auto-scheduled administration
- Medication Administration Record (MAR) grid view
- Nurse rounds with structured notes
- Intake/Output charting (8 categories — oral, IV, NG, urine, stool, vomit, drain, other)
- Medication reconciliation at admission + discharge

**Wards & Beds**
- Ward types (GENERAL / PRIVATE / SEMI_PRIVATE / ICU / NICU / HDU / EMERGENCY / MATERNITY)
- Bed status tracking (AVAILABLE / OCCUPIED / CLEANING / MAINTENANCE / RESERVED)
- Per-bed daily rates

### 🚨 Emergency / Triage

- Emergency case intake (registered patients or John/Jane Doe)
- 5-level triage (RESUSCITATION / EMERGENT / URGENT / LESS_URGENT / NON_URGENT)
- MEWS score + Glasgow Coma Scale
- **Revised Trauma Score (RTS)** calculator
- Live ER board (4-column status layout)
- Wait-time tracking with triage-level targets
- Door-to-doctor time analytics
- **MLC / Police case** tracking
- Repeat visit detection (within 72h)
- Mass casualty mode (bulk register unknowns)
- **ER-to-admission conversion** (creates IPD admission in one click)

### 🔪 Surgery / Operating Theater

- OT management with daily rates
- Surgery scheduling with surgeon, OT, duration, anesthesiologist, assistants
- Auto-generated case number (SRG######)
- **Pre-op checklist** (consent, NPO, allergies, antibiotics, site-mark, blood reserved) — enforced at /start
- **Intra-op timing** (anesthesia start/end, incision, closure)
- **Post-op checklist** (sponge count, instrument count, specimen labeled, patient stable)
- **Post-op PACU recovery** tracking (vitals timeline)
- **Complications** tracking with severity
- **Surgical site infection (SSI)** tracking + analytics
- **Anesthesia record** (type, agents, vitals log, IV fluids, blood loss)
- **Blood requirement** cross-check with auto-reserve
- **OT utilization** analytics
- **OT turnaround time** tracking
- Weekly OT calendar view
- Consent form support

### 🤰 Maternity / Antenatal

- ANC case management (one active per pregnancy)
- EDD auto-calculation (LMP + 280 days)
- **Trimester tracking**
- Visit types (FIRST / ROUTINE / HIGH_RISK / SCAN / DELIVERY / POSTNATAL)
- Per-visit data (gestation weeks, weight, BP, fundal height, FHR, urine tests, hemoglobin)
- **ACOG risk scoring** algorithm with auto-flagging
- **Partograph** for labor monitoring with SVG chart
- **Ultrasound records**
- Delivery outcome (type, baby gender/weight, outcome notes)
- **Postnatal visit checklist** (lochia, involution, breastfeeding, mental health, baby exam)
- Visit timeline visualization (LMP → today → EDD)

### 👶 Pediatric

- Growth records (weight, height, head circumference, BMI)
- WHO percentile calculation with linear interpolation
- Growth charts with milestone markers (2/4/6/9/12/18/24 months)
- **Failure-to-thrive (FTT) alerts** (percentile drops, velocity)
- **Interactive milestone checklist** (GROSS_MOTOR / FINE_MOTOR / LANGUAGE / SOCIAL / COGNITIVE across 39 milestones)
- **Feeding log** (breast, bottle, solids) with daily totals
- **Immunization compliance** checker (India UIP schedule)

### 📋 Electronic Health Records

- **Allergies** with 4 severity levels + alert banners for SEVERE/LIFE_THREATENING
- **Chronic conditions** with ICD-10 codes
- **Family history**
- **Immunizations** with UIP schedule, next-due tracking, overdue alerts
- **Patient documents** (base64 upload: LAB_REPORT, IMAGING, CONSENT, INSURANCE, etc.)
- **Consolidated problem list** (unified view across conditions, diagnoses, allergies, active admissions)
- **Medication reconciliation** at admission and discharge
- **Advance directives / DNR** orders with patient chart banner
- **CCDA / Continuity of Care** JSON export
- **Patient 360° view** with timeline, sparklines, key metrics
- **Patient merge** (combine duplicates)
- **Family linking** (parent/child/spouse/sibling)

### 💉 Immunizations

- Full India UIP pediatric schedule (BCG, OPV, Pentavalent, Rotavirus, IPV, MR, JE, DPT boosters)
- Adult vaccines (Influenza, Hep B, Typhoid, Tdap, HPV, Pneumococcal, COVID, MMR, Varicella)
- Compliance dashboard with overdue alerts
- Batch number + manufacturer tracking
- Next-due date calculations

### 🩸 Blood Bank

- **Donor registry** with eligibility tracking
- **Donations** with unit numbers, approval workflow, screening notes
- **Screening tests** (HIV, HCV, HBsAg, Syphilis, Malaria) — auto-discards units on fail
- **Donor deferral** tracking (malaria area, piercing, pregnancy, medication)
- **Blood units** by component (WHOLE / PRBC / PLATELETS / FFP / CRYO)
- **Component separation** (1 whole blood → multiple components with component-specific expiry)
- **Inventory** by blood group + component with expiry
- **Blood requests** with urgency levels
- **ABO/Rh compatibility matrix** + donor eligibility check
- **Unit reservation** with 24h expiry + auto-release cron
- **Cross-match history**
- **Temperature logs** for storage compliance
- **Low-stock alerts**
- **Next-donation reminders** (90-day rule)

### 🚑 Ambulance

- Fleet management (BLS / ALS / ICU / Patient Transport)
- Trip lifecycle (REQUESTED → DISPATCHED → ARRIVED_SCENE → EN_ROUTE_HOSPITAL → COMPLETED)
- Driver + paramedic tracking
- **GPS coordinates** for trip tracking
- **Dispatch priority** (RED / YELLOW / GREEN)
- **Equipment check** before trip
- **Fuel logs**
- Distance & cost logging
- Trip billing integration

### 🏗️ Assets

- Asset registry (Medical Equipment / IT / Furniture / Vehicles)
- Status tracking (IN_USE / IDLE / UNDER_MAINTENANCE / RETIRED / LOST)
- Assignment history per staff
- **Maintenance logs** (SCHEDULED / BREAKDOWN / CALIBRATION / INSPECTION)
- **Calibration schedule** with due-date tracking
- **Depreciation** calculation (straight-line method)
- **Warranty expiry** alerts (next 30 days)
- **AMC** tracking with renewal alerts
- **Transfer history** between departments
- **Disposal workflow** (sold / scrapped / donated)
- **QR code payload** for asset tags

### 🧪 Laboratory

- Test catalog (40+ tests across Hematology, Biochemistry, Microbiology, Imaging)
- Lab orders with multi-test support
- **STAT priority** with auto-notify to lab tech + ordering doctor
- Sample tracking (ORDERED → SAMPLE_COLLECTED → IN_PROGRESS → COMPLETED / SAMPLE_REJECTED)
- **Reference ranges by age/gender**
- **Panic value** flagging with critical alerts
- **Delta check** — auto-compare with patient's previous results (>25% flagged)
- **Result verification workflow** (tech enters → doctor verifies)
- **Batch result entry**
- **Sample rejection** workflow
- **TAT (turnaround time)** tracking + breach alerts
- **QC tracking** with Levey-Jennings chart (mean ± 2SD/3SD)
- **Lab report PDF** generation
- **Patient-facing result sharing** (signed URL, 7-day expiry)
- **Result trends** (sparklines per parameter)
- Flag colors (NORMAL / LOW / HIGH / CRITICAL)

### 💊 Pharmacy

- Medicine catalog (60+ medicines with generic names, brands, forms, strengths, categories)
- **Drug interactions** with severity levels (MILD / MODERATE / SEVERE / CONTRAINDICATED)
- Inventory with batch tracking, expiry, cost
- **Barcode lookup**
- Stock movements (PURCHASE / DISPENSED / EXPIRED / RETURNED / DAMAGED / ADJUSTMENT)
- **Batch recall** and quarantine
- **Reorder suggestions** based on consumption rate
- **Low stock alerts**
- **Expiry tracking** (30/60/90 days)
- **Dispense from prescription** (FEFO batch selection)
- **Auto-billing on dispense** (adds line items to PENDING invoice)
- **Returns / exchanges** workflow
- **Stock transfers** between departments
- **Low-stock supplier email** (stub with draft PO creation)
- **Narcotics / Schedule H/X** ledger
- **Controlled Substance Register** with running balance + auto-entry on dispense
- **Valuation methods** (FIFO / LIFO / Weighted Average)
- **Purchase orders** (DRAFT → PENDING → APPROVED → RECEIVED)
- **GRN** (Goods Receipt Note) with partial receipts

### 💰 Billing & Finance

**Invoicing**
- Line items with categories (Consultation / Procedure / Medicine / Lab / Other)
- **GST breakdown** (CGST 9% + SGST 9% + total 18%)
- Hospital GSTIN on invoice
- **Discount application** (percentage or flat)
- **Discount approval workflow** (>threshold requires admin approval)
- **Invoice watermarks** (CANCELLED / PAID / DRAFT) in print view
- **Tax invoice** print format
- Add / remove line items on pending invoices
- **Credit notes** for post-payment adjustments
- **Consolidated IPD bill** (aggregates all services)
- **Late-fee automation** (configurable grace days + flat/percent)
- **Patient pricing tiers** (STANDARD / EMPLOYEE / SENIOR_CITIZEN / BPL / VIP) with auto-discount

**Payments**
- CASH / CARD / UPI / ONLINE / INSURANCE modes
- **Razorpay** integration (order + verification)
- **Partial payments**
- **Refunds** with reason tracking
- **Bulk payments** across multiple invoices
- **Advance deposits** with auto-consumption on invoice
- **Payment plans / EMI** (multi-installment with auto-reminders)
- Payment timeline visualization

**Insurance**
- **Pre-authorization** requests with status workflow
- Insurance claims (SUBMITTED → APPROVED / REJECTED → SETTLED)
- Claim reference number tracking

**Health Packages**
- 5 pre-seeded packages (Master Checkup, Diabetes Care, Cardiac Wellness, Pregnancy Care, Senior Citizen)
- Patient purchases with validity tracking
- Service consumption tracking
- Package-based auto-discount on matching services
- Package renewal
- Family packages (multiple patients per purchase)

**Suppliers & Procurement**
- Supplier registry with GST, payment terms
- **Contracts** with expiry alerts
- **Performance metrics** (on-time delivery, variance, rating)
- **Supplier payments** tracking
- **Supplier catalog** (preferred items with pricing)
- Purchase orders with multi-step approval
- **GRN** (Goods Receipt Note) with partial receipts
- **Recurring POs** for monthly items

**Expenses**
- 8 categories (Salary / Utilities / Equipment / Maintenance / Consumables / Rent / Marketing / Other)
- **Approval workflow** for amounts > threshold
- **Monthly budgets** per category with variance tracking
- **Recurring expenses** (rent, utilities auto-creation)
- Attachments for receipts

### 👥 Staff HR

- **Duty roster** grid by shift type (Morning / Afternoon / Night / On-Call)
- **Shift check-in/out** with LATE detection (>15 min)
- **Bulk shift assignment**
- **My Schedule** 7-day view for staff
- **Leave requests** with 6 types (CASUAL / SICK / EARNED / MATERNITY / PATERNITY / UNPAID)
- **Leave approval workflow** with auto-shift update on approval
- **Leave balances** per type per year
- **Leave calendar** (month view of who's on leave)
- **Holiday calendar** with Indian holidays template
- **Attendance summary** (monthly per user)
- **Payroll calculation** (basic + allowances + overtime - deductions)
- **Overtime tracking** with approval workflow
- **Staff certifications** with expiry tracking (medical license, nursing cert, BLS, ACLS)
- Timesheet management

### 👨‍⚕️ Telemedicine

- Video sessions with auto-generated Jitsi Meet URLs
- Session workflow (SCHEDULED → WAITING → IN_PROGRESS → COMPLETED)
- "Join Call" active within 15 min of scheduled time
- **In-session chat**
- **Tech issues** tracking
- **Patient waiting room** indicator
- **Session ratings** (1-5 stars)
- **Prescription creation** during session
- Follow-up scheduling
- Integration with billing

### 🔔 Notifications

- Multi-channel: WhatsApp / SMS / Email / Push (stubs for real API keys)
- **Notification preferences** per channel per user
- **Notification templates** customizable per event
- **Notification schedule** (quiet hours / DND)
- **Admin broadcasts** with audience selector (all staff / role / specific users)
- **Delivery tracking** (QUEUED / SENT / DELIVERED / READ / FAILED)
- **Notification history** (200+ log entries)
- 13 notification types (appointment, reminder, bill, payment, prescription, etc.)

### 🗣️ Patient Engagement

**Feedback**
- 5-star ratings per category (Doctor / Nurse / Reception / Cleanliness / Food / Waiting / Billing / Overall)
- NPS scoring (0-10)
- **Auto sentiment analysis** (POSITIVE / NEUTRAL / NEGATIVE)
- **Public feedback link** for SMS/WhatsApp (/feedback/[patientId])
- Feedback trend charts (NPS over time)
- 12-month rating trends

**Complaints**
- Auto-generated ticket numbers
- 4 priority levels with auto-SLA (CRITICAL 4h / HIGH 24h / MEDIUM 72h / LOW 168h)
- **SLA countdown** with at-risk dashboard
- Auto-escalation for overdue SLAs
- Assignment workflow
- Resolution tracking
- Management response dashboard

**Internal Chat**
- 1-on-1 and group rooms
- Real-time via Socket.IO
- **Message reactions** (6 emojis)
- **Pinning** with banner
- **@mentions** with auto-notifications
- **Department channels** (auto-populated by role)
- Typing indicators
- Message search
- Threading support
- Unread counts + read receipts

**Visitors**
- Check-in / check-out with ID proof
- **Photo capture** (webcam + upload fallback)
- Printable passes
- **Blacklist** with reasons
- **Per-patient limits** (max 2 active)
- Visitor history per patient
- **Peak-hour analytics**

### 📊 Analytics & Reports

**Analytics Dashboard**
- Overview KPIs with **period comparison** (vs previous period / previous year)
- **Date range presets** (Today / This Week / Last Month / This Year / Custom)
- Appointment trends (scheduled vs walk-in)
- Revenue analytics (by mode / doctor / category / ward)
- Doctor performance (sortable)
- Top diagnoses
- Patient demographics (gender / age groups)
- IPD occupancy
- Patient retention (new vs returning)
- **No-show analysis** (by doctor / day / hour heatmap)
- **ER performance** (wait times / dispositions / LWBS rate)
- **IPD trends** (avg LOS / readmission rate)
- **Pharmacy expiry risk** (value at risk)
- **Feedback trends** (NPS over time)
- **Benchmarks** (current vs prior / YoY / percentile rank)
- **Forecasting** (linear regression projection)

**Reports**
- Daily billing collection
- Payment mode breakdown
- Outstanding invoices
- Insurance claim status
- **Scheduled email reports** (daily / weekly / monthly)
- **Report history** with snapshots
- **Custom Report Builder** with saved configurations

**Exports**
- Revenue CSV
- Appointments CSV
- Patients CSV
- Audit log CSV
- Print-friendly dashboard

**Dashboards per role**
- **Admin Control Center** (system health + critical alerts + pending approvals + resource usage)
- **Doctor Workspace** (queue + pending tasks + admitted patients)
- **Nurse Workstation** (medications due + ER triage + assigned patients)
- **Patient Portal** (upcoming appointments + bills + prescriptions)
- **Unified Calendar** (all scheduled events across modules)

### 🔐 Admin & System

- **Global search palette** (Ctrl+K) across patients, appointments, invoices, prescriptions, admissions, surgeries, labs
- User management (ADMIN / DOCTOR / RECEPTION / NURSE / PATIENT)
- Role-based access control (RBAC) on every endpoint
- **Audit logging** for all key actions (LOGIN, BOOK, UPDATE, PAY, etc.) with advanced search
- Audit CSV export for compliance
- **Rate limiting** (100 req/min global, 10 req/min on auth)
- **Input sanitization** (HTML tag stripping)
- **Password reset** with 6-digit code
- **Change password** for logged-in users
- JWT sessions with refresh tokens
- **Dashboard widget preferences** (saved per user)

### 🎨 UX & Accessibility

- **Dark mode** with system preference detection
- **Accessibility** (WCAG AA) — skip link, focus rings, aria labels
- **Print layouts** optimized for invoice, prescription, admission, lab report, patient record
- **i18n** (English + Hindi) for login/register/feedback
- **PWA manifest** with icons (installable on mobile)
- **Keyboard shortcuts**:
  - `Ctrl+K` — global search
  - `g h/a/p/q` — navigate to home/appointments/patients/queue
  - `?` — keyboard shortcut help
  - `Esc` — close modals
- **Toast notifications** (replaces alerts)
- **Loading skeletons**
- **Bulk operations** on appointments
- **Offline mode** for waiting-area token display

---

## Tech Stack

### Backend
- **Node.js 20+** + **Express.js 4** (TypeScript, CommonJS)
- **PostgreSQL 16** via **Prisma 6** ORM
- **JWT** + **bcryptjs** for auth
- **Socket.IO** for real-time queue & chat
- **Zod** for request validation
- Base64 file upload (no multer dependency)

### Web Frontend
- **Next.js 15** + **React 19** (App Router, TypeScript)
- **Tailwind CSS v4** with `@theme` CSS variables + `@custom-variant dark`
- **Zustand** for state (auth, theme, toast)
- **lucide-react** icons
- **socket.io-client**
- Pure SVG charts (no chart library dependency)

### Mobile
- **React Native** via **Expo SDK 53+**
- **expo-router** (file-based navigation)
- **expo-secure-store** for tokens

### DevOps
- **Turborepo** monorepo
- **npm workspaces**
- **PM2** process manager with systemd startup
- **Docker** for PostgreSQL
- **nginx** reverse proxy + **Certbot** SSL
- **Paramiko** (Python) for deployment automation

### Infrastructure
- **Ubuntu 22.04** server
- **Let's Encrypt** SSL (auto-renewed)
- **Cron jobs** — nightly backups (2 AM), 5-min health checks
- **Backup retention** — 30 days with gzip

---

## Architecture & Project Structure

```
medcore/
├── apps/
│   ├── api/                    # Express.js backend
│   │   └── src/
│   │       ├── index.ts        # App entrypoint, router wiring, socket.io
│   │       ├── middleware/
│   │       │   ├── auth.ts     # JWT authentication + RBAC
│   │       │   ├── audit.ts    # Action logging
│   │       │   ├── error.ts    # Error handler
│   │       │   ├── rate-limit.ts
│   │       │   ├── sanitize.ts
│   │       │   └── validate.ts # Zod schema validation
│   │       ├── routes/         # 60+ API route files
│   │       └── services/
│   │           ├── notification.ts
│   │           ├── notification-triggers.ts
│   │           ├── pdf.ts                 # Prescription PDF
│   │           ├── razorpay.ts
│   │           ├── vitals-analysis.ts
│   │           ├── vitals-baseline.ts
│   │           ├── ops-helpers.ts         # GST, sentiment, SLA, mentions
│   │           └── waitlist.ts
│   ├── web/                    # Next.js frontend (73+ pages)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── dashboard/             # 65+ dashboard pages
│   │       │   ├── login/ register/ forgot-password/
│   │       │   ├── display/               # Waiting-area TV
│   │       │   └── feedback/              # Public patient feedback
│   │       ├── components/
│   │       │   ├── Toast.tsx
│   │       │   ├── Skeleton.tsx
│   │       │   ├── LanguageDropdown.tsx
│   │       │   └── KeyboardShortcutsModal.tsx
│   │       └── lib/
│   │           ├── api.ts                 # HTTP client
│   │           ├── store.ts               # Zustand auth store
│   │           ├── theme.ts               # Dark mode store
│   │           ├── toast.ts               # Toast store
│   │           ├── i18n.ts                # Translation store
│   │           └── socket.ts              # Socket.IO client
│   └── mobile/                 # React Native (Expo)
├── packages/
│   ├── shared/                 # Shared types & Zod validation
│   │   └── src/
│   │       ├── types/
│   │       └── validation/     # 20+ validation files per domain
│   └── db/                     # Prisma schema + seeds
│       ├── prisma/
│       │   └── schema.prisma   # 110+ models
│       └── src/
│           ├── index.ts        # Prisma client export
│           └── seed-*.ts       # 25+ seed scripts
├── scripts/                    # Deployment & ops scripts
│   ├── pm2-setup.sh
│   ├── backup-db.sh
│   ├── restore-db.sh
│   ├── deploy.sh
│   └── healthcheck.sh
├── backups/                    # Gzipped SQL backups (gitignored)
├── docs/
│   └── PRD.md                  # Original product requirements
├── turbo.json
└── package.json
```

---

## Roles & Permissions

| Role | Access |
|------|--------|
| **ADMIN** | Full system access — users, schedules, reports, audit, analytics, all modules |
| **DOCTOR** | Consultations, prescriptions, queue, patient history, referrals, surgery, telemedicine, ANC |
| **NURSE** | Vitals, medication admin, IPD, emergency triage, blood bank, immunizations |
| **RECEPTION** | Appointments, walk-ins, billing, visitors, emergency intake, ambulance dispatch |
| **PATIENT** | Own appointments, prescriptions, bills, telemedicine, notifications |

---

## Module Reference

Full list of 70+ modules with their API routes and web pages.

### Clinical
| Module | API | Web |
|--------|-----|-----|
| Appointments | `/api/v1/appointments/*` | `/dashboard/appointments` |
| Queue | `/api/v1/queue/*` | `/dashboard/queue`, `/display` |
| Walk-in | `/api/v1/appointments/walk-in` | `/dashboard/walk-in` |
| Patients | `/api/v1/patients/*` | `/dashboard/patients`, `/patients/[id]`, `/patients/[id]/problem-list` |
| Doctors | `/api/v1/doctors/*` | `/dashboard/doctors` |
| Schedule | `/api/v1/doctors/:id/schedule` | `/dashboard/schedule` |
| Vitals | `/api/v1/patients/:id/vitals` | `/dashboard/vitals` |
| Prescriptions | `/api/v1/prescriptions/*` | `/dashboard/prescriptions` |
| Controlled Substances | `/api/v1/controlled-substances/*` | `/dashboard/controlled-substances` |
| Waitlist | `/api/v1/waitlist/*` | (integrated) |
| Coordinated Visits | `/api/v1/coordinated-visits/*` | (integrated) |
| Med Reconciliation | `/api/v1/med-reconciliation/*` | (integrated in admissions) |

### Inpatient & Acute
| Module | API | Web |
|--------|-----|-----|
| Wards | `/api/v1/wards/*`, `/beds/*` | `/dashboard/wards` |
| Admissions | `/api/v1/admissions/*` | `/dashboard/admissions`, `/admissions/[id]` |
| Medication | `/api/v1/medication/*` | `/dashboard/medication-dashboard` |
| Nurse Rounds | `/api/v1/nurse-rounds/*` | (integrated) |
| Census | `/api/v1/admissions/census/*` | `/dashboard/census` |
| Emergency | `/api/v1/emergency/*` | `/dashboard/emergency`, `/emergency/[id]` |
| Surgery | `/api/v1/surgery/*` | `/dashboard/surgery`, `/surgery/[id]` |
| OT | `/api/v1/surgery/ots/*` | `/dashboard/ot` |

### Specialty
| Module | API | Web |
|--------|-----|-----|
| Telemedicine | `/api/v1/telemedicine/*` | `/dashboard/telemedicine` |
| Antenatal | `/api/v1/antenatal/*` | `/dashboard/antenatal`, `/antenatal/[id]` |
| Pediatric Growth | `/api/v1/growth/*` | `/dashboard/pediatric`, `/pediatric/[id]` |
| EHR | `/api/v1/ehr/*` | (integrated in patient detail) |
| Immunizations | `/api/v1/ehr/immunizations/*` | `/dashboard/immunization-schedule` |
| Referrals | `/api/v1/referrals/*` | `/dashboard/referrals` |

### Diagnostics & Pharmacy
| Module | API | Web |
|--------|-----|-----|
| Medicines | `/api/v1/medicines/*` | `/dashboard/medicines` |
| Pharmacy | `/api/v1/pharmacy/*` | `/dashboard/pharmacy` |
| Lab | `/api/v1/lab/*` | `/dashboard/lab`, `/lab/[id]` |
| Lab QC | `/api/v1/lab/qc/*` | `/dashboard/lab/qc` |
| Blood Bank | `/api/v1/bloodbank/*` | `/dashboard/bloodbank` |
| Ambulance | `/api/v1/ambulance/*` | `/dashboard/ambulance` |
| Assets | `/api/v1/assets/*` | `/dashboard/assets` |

### Finance
| Module | API | Web |
|--------|-----|-----|
| Billing | `/api/v1/billing/*` | `/dashboard/billing`, `/billing/[id]`, `/billing/patient/[id]` |
| Refunds | `/api/v1/billing/refunds` | `/dashboard/refunds` |
| Payment Plans | `/api/v1/payment-plans/*` | `/dashboard/payment-plans` |
| Pre-Auth | `/api/v1/preauth/*` | `/dashboard/preauth` |
| Discount Approvals | `/api/v1/billing/discount-approvals/*` | `/dashboard/discount-approvals` |
| Packages | `/api/v1/packages/*` | `/dashboard/packages` |
| Suppliers | `/api/v1/suppliers/*` | `/dashboard/suppliers` |
| Purchase Orders | `/api/v1/purchase-orders/*` | `/dashboard/purchase-orders` |
| Expenses | `/api/v1/expenses/*` | `/dashboard/expenses` |
| Budgets | (integrated in expenses) | `/dashboard/budgets` |

### HR & Admin
| Module | API | Web |
|--------|-----|-----|
| Shifts | `/api/v1/shifts/*` | `/dashboard/my-schedule`, `/duty-roster` |
| Leaves | `/api/v1/leaves/*` | `/dashboard/leave-management`, `/my-leaves`, `/leave-calendar` |
| Holidays | `/api/v1/hr-ops/holidays` | `/dashboard/holidays` |
| Payroll | `/api/v1/hr-ops/payroll` | `/dashboard/payroll` |
| Certifications | `/api/v1/hr-ops/certifications` | `/dashboard/certifications` |
| Users | `/api/v1/users/*` | `/dashboard/users` |
| Reports | `/api/v1/billing/reports/*` | `/dashboard/reports` |
| Scheduled Reports | `/api/v1/scheduled-reports/*` | `/dashboard/scheduled-reports` |
| Analytics | `/api/v1/analytics/*` | `/dashboard/analytics`, `/analytics/reports` |
| Audit | `/api/v1/audit/*` | `/dashboard/audit` |
| Admin Console | (aggregates) | `/dashboard/admin-console` |

### Engagement
| Module | API | Web |
|--------|-----|-----|
| Notifications | `/api/v1/notifications/*` | `/dashboard/notifications` |
| Broadcasts | `/api/v1/notifications/broadcasts` | `/dashboard/broadcasts` |
| Feedback | `/api/v1/feedback/*` | `/dashboard/feedback`, `/feedback/[id]` (public) |
| Complaints | `/api/v1/complaints/*` | `/dashboard/complaints` |
| Chat | `/api/v1/chat/*` | `/dashboard/chat` |
| Visitors | `/api/v1/visitors/*` | `/dashboard/visitors` |
| Calendar | (aggregates) | `/dashboard/calendar` |
| Workspace (Doctor) | (aggregates) | `/dashboard/workspace` |
| Workstation (Nurse) | (aggregates) | `/dashboard/workstation` |
| Search | `/api/v1/search` | (palette via Ctrl+K) |

---

## Local Setup

### Prerequisites
- Node.js 20+
- npm 10+
- Docker (for PostgreSQL)
- Git

### Steps

```bash
# 1. Clone
git clone https://github.com/Globussoft-Technologies/medcore.git
cd medcore

# 2. Install dependencies
npm install

# 3. Start PostgreSQL via Docker
docker run -d --name medcore-postgres \
  -e POSTGRES_USER=medcore \
  -e POSTGRES_PASSWORD=medcore_dev \
  -e POSTGRES_DB=medcore \
  -p 5433:5432 \
  postgres:16-alpine

# 4. Set up environment
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with your DATABASE_URL

echo 'DATABASE_URL="postgresql://medcore:medcore_dev@localhost:5433/medcore?schema=public"' > .env

# 5. Push schema + seed
npx prisma generate --schema packages/db/prisma/schema.prisma
npx prisma db push --schema packages/db/prisma/schema.prisma

# Core seed
npx tsx packages/db/src/seed-realistic.ts

# Module seeds (run in this order)
npx tsx packages/db/src/seed-pharmacy.ts
npx tsx packages/db/src/seed-ipd.ts
npx tsx packages/db/src/seed-clinical.ts
npx tsx packages/db/src/seed-hr.ts
npx tsx packages/db/src/seed-finance.ts
npx tsx packages/db/src/seed-phase4-ops.ts
npx tsx packages/db/src/seed-phase4-specialty.ts
npx tsx packages/db/src/seed-phase4-engagement.ts
npx tsx packages/db/src/seed-clinical-enhancements.ts
npx tsx packages/db/src/seed-acute-care-enhancements.ts
npx tsx packages/db/src/seed-ancillary-enhancements.ts
npx tsx packages/db/src/seed-ops-enhancements.ts
npx tsx packages/db/src/seed-lab-data.ts
npx tsx packages/db/src/seed-immunization-data.ts
npx tsx packages/db/src/seed-pediatric-patients.ts
npx tsx packages/db/src/seed-chat-conversations.ts
npx tsx packages/db/src/seed-complaints-data.ts
npx tsx packages/db/src/seed-asset-history.ts
npx tsx packages/db/src/seed-doctor-ratings.ts
npx tsx packages/db/src/seed-visitors-history.ts
npx tsx packages/db/src/seed-notifications-history.ts
npx tsx packages/db/src/seed-lab-panels.ts
npx tsx packages/db/src/seed-medicine-leaflets.ts

# 6. Run dev servers
npm run dev
# Web: http://localhost:3000
# API: http://localhost:4000
```

### Mobile App

```bash
cd apps/mobile
npx expo start
# Scan QR with Expo Go app
```

---

## Deployment

Production runs on a single Ubuntu 22.04 server with:
- **nginx** reverse proxy at `medcore.globusdemos.com`
- **PM2** running `medcore-api` (port 4100) and `medcore-web` (port 3200)
- **Docker PostgreSQL** at port 5433
- **Let's Encrypt SSL** via Certbot
- **Cron jobs** for backups and health checks

### Deploy script (server-side)

```bash
cd ~/medcore
./scripts/deploy.sh            # Pull, install, migrate, build, restart
./scripts/deploy.sh --seed     # Plus re-seed DB
```

### Paramiko-based deploy (local)

```bash
python deploy_v12.py           # Full deployment from local machine
```

*Note: `deploy_*.py` files are gitignored — they contain server credentials.*

---

## Operations

### Backups

- **Automatic** — daily at 2 AM via cron
- **Retention** — 30 days, gzipped
- **Location** — `/home/empcloud-development/medcore/backups/`

```bash
./scripts/backup-db.sh                                    # Manual backup
./scripts/restore-db.sh backups/medcore_YYYYMMDD.sql.gz   # Restore
```

### Health Monitoring

- Cron runs `healthcheck.sh` every 5 minutes
- Auto-restarts API / Web / Postgres if down
- Logs to `~/logs/medcore-health.log`

### PM2 Commands

```bash
pm2 list                            # Show all processes
pm2 logs medcore-api --lines 50     # Tail logs
pm2 restart medcore-api medcore-web # Restart services
pm2 save                            # Persist state
```

---

## Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@medcore.local` | `admin123` |
| Doctor | `dr.sharma@medcore.local` | `doctor123` |
| Doctor | `dr.patel@medcore.local` | `doctor123` |
| Doctor | `dr.khan@medcore.local` | `doctor123` |
| Reception | `reception@medcore.local` | `reception123` |
| Nurse | `nurse@medcore.local` | `nurse123` |
| Patient | `patient1@medcore.local` | `patient123` |

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| **v1.2.0** | 2026-04-14 | Comprehensive feature pass: 70+ features across all modules via 7 parallel agents. Controlled Substance Register, EMI plans, bed forecast, partograph, ACOG risk scoring, audit advanced search, dark mode, PWA, i18n, bulk ops |
| **v1.1.0** | 2026-04-14 | Deep re-audit: 30+ features. UI for hidden backends (SLA countdown, payroll, budgets, broadcasts, holidays), cross-module integrations (Ctrl+K search, Patient 360°, Admin Console, Unified Calendar), module-deep (Rx interaction check, STAT labs, discharge checklist, blood reservation) |
| **v1.0.0** | 2026-04-13 | Initial complete release: Full Phase 1-4 hospital system. 54 pages, 200+ endpoints, 80+ Prisma models. OPD, IPD, ER, Surgery, Lab, Pharmacy, Blood Bank, Ambulance, HR, Finance, Analytics |

### Development Phases

**Phase 1 — OPD Foundation** → Monorepo, auth, appointments, walk-ins, patients, OPD workflow, prescriptions, billing, notifications, live queue, web + mobile apps

**Phase 2 — Clinical & Diagnostics** → IPD, MAR, Lab ordering + results, Pharmacy inventory, Medicine database with interactions, Analytics dashboard

**Phase 3 — Extended Clinical & Ops** → EHR (allergies, conditions, immunizations, documents), Referrals, Surgery/OT, HR (shifts, leaves), POs, Health packages, Expenses

**Phase 4 — Specialty & Engagement** → Telemedicine, ER/Triage, Blood Bank, Ambulance, Asset management, Antenatal, Pediatric growth, Feedback, Complaints, Internal chat, Visitor management

**Production Hardening** → Password reset, audit logging, rate limiting, input sanitization, PM2 systemd startup, automated daily backups, cron-based health checks

**Deepening Pass (v1.0 internal)** → Enhanced dashboard with all-module summary, appointments calendar view, patient 360°, billing refunds, analytics drill-down

**Deep Re-Audit Pass (v1.1.0)** → UI for hidden backend features, cross-module integrations, module-specific deep features, 8 enhancement seed files

**Comprehensive Feature Pass (v1.2.0)** → 7 parallel agents covering high/medium/low-impact features across every module

---

## License

This is a demonstration project. License file included in repository.

---

## Acknowledgments

Built end-to-end using Claude Code with systematic parallel agent orchestration for rapid feature delivery.
