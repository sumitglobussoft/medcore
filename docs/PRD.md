# MedCore - Hospital Operations Automation System (PRD)

## Context

A large hospital (150+ OPD patients/day, 3 doctors) currently only has an online token booking website. The goal is to build a comprehensive hospital operations automation system covering appointment booking, walk-ins, OPD management, billing, prescriptions, and multi-channel notifications — across web and mobile platforms.

---

## 1. Product Overview

**Product Name:** MedCore  
**Tagline:** Streamlining hospital operations from reception to prescription  
**Platforms:** Web Application (Next.js) + Mobile Application (React Native)  
**Backend:** Node.js (Express) + PostgreSQL  

### 1.1 Goals
- Automate end-to-end OPD operations (booking → consultation → billing → prescription)
- Reduce patient wait times with slot-based appointments + walk-in token queue
- Enable real-time notifications across WhatsApp, SMS, Email, and Push
- Provide role-based access for Doctors, Reception, and Nurses
- Support full billing lifecycle including insurance/TPA and online payments

### 1.2 Phases
| Phase | Scope |
|-------|-------|
| **Phase 1 (Basic)** | Appointment booking, walk-ins, OPD management, billing, prescriptions, notifications, web + mobile |
| **Phase 2 (Advanced)** | Indoor/inpatient management, nurse data entry for admitted patients |

---

## 2. User Roles & Permissions

### 2.1 Roles

| Role | Count | Access |
|------|-------|--------|
| **Admin** | 1 | Full system access, user management, settings, reports |
| **Doctor** | 3 | View appointments, manage consultation queue, write prescriptions, view patient history |
| **Reception** | 1+ | Book appointments, manage walk-ins, handle billing, patient registration |
| **Nurse** | 1+ | OPD management, vitals entry, patient prep, queue management |
| **Patient** | N | Book appointments, view prescriptions, pay bills, view history |

### 2.2 Authentication
- **Staff (Admin, Doctor, Reception, Nurse):** Username + Password with role-based access control
- **Patients:** Username + Password (email or phone as username)
- Session management with JWT tokens
- Password reset via email

---

## 3. Core Modules

### 3.1 Appointment Booking

**Slot-Based Appointments (Online)**
- Patients select doctor → view available date → pick time slot
- Doctors define availability: working days, shift timings, slot duration (e.g., 15 min)
- Slots auto-generated based on doctor schedule
- Booking confirmation with token number assigned
- Cancellation/rescheduling allowed up to X hours before appointment
- Prevents double-booking; real-time slot availability

**Walk-in Token Queue**
- Reception registers walk-in patient → assigns next token number
- Token queue runs parallel to scheduled appointments
- Doctor sees merged queue: scheduled patients at their slot time, walk-ins fill gaps
- Display current token number on a patient-facing screen/dashboard
- Estimated wait time calculation based on average consultation duration

**Doctor Schedule Management**
- Doctors set weekly recurring schedule (e.g., Mon-Fri 10:00-13:00, 16:00-19:00)
- Block specific dates/slots (leave, emergency)
- Reception can override schedule for urgent cases

### 3.2 Patient Management (OPD)

**Patient Registration**
- New patient: name, age, gender, phone, email, address, blood group, emergency contact
- Unique Patient ID (MR number) auto-generated
- Search patients by name, phone, or MR number
- Patient profile with complete visit history

**OPD Workflow**
1. **Check-in:** Patient arrives → Reception marks attendance (or auto check-in for online bookings)
2. **Vitals:** Nurse records vitals — BP, temperature, weight, height, SpO2, pulse
3. **Queue:** Patient moves to doctor's consultation queue
4. **Consultation:** Doctor views patient history + vitals, conducts consultation
5. **Prescription:** Doctor writes prescription with digital signature
6. **Billing:** Reception generates bill, collects payment
7. **Checkout:** Patient receives prescription + bill via WhatsApp/Email

**Patient History**
- Timeline view of all visits
- Past prescriptions, vitals, diagnoses
- Billing history

### 3.3 Prescription Management

**Features**
- Doctor writes prescription during/after consultation
- Fields: diagnosis, medicines (name, dosage, frequency, duration), advice/notes
- Digital signature (eSign) of the prescribing doctor for validity
- Generate printable PDF with hospital letterhead
- Share prescription via WhatsApp, Email, or SMS link
- Patient can view all past prescriptions in their portal/app

**Prescription Data**
- Medicine name (free text for Phase 1, medicine DB in future)
- Dosage, frequency (e.g., 1-0-1), duration
- Special instructions (before/after food, etc.)
- Follow-up date recommendation

### 3.4 Billing Management

**Invoice Generation**
- Line items: consultation fee, procedures, medicines, tests
- Tax calculation (GST if applicable)
- Discount support (percentage or flat)
- Auto-generate invoice number (sequential)
- Print-ready invoice with hospital details

**Payment Collection**
- **Offline:** Cash, Card, UPI (manual entry by reception)
- **Online:** Payment gateway integration (Razorpay) for advance booking fees
- Payment status tracking: Paid, Partial, Pending, Refunded
- Receipt generation and sharing (WhatsApp/Email/Print)

**Insurance / TPA**
- Link patient to insurance provider
- TPA (Third Party Administrator) claim support
- Track claim status: Submitted, Approved, Rejected, Settled
- Separate billing for insured vs. self-pay patients
- Co-pay / deductible calculation

**Reports**
- Daily collection summary
- Payment mode breakdown
- Outstanding payments
- Insurance claim status report

### 3.5 Notifications

**Channels:** WhatsApp (primary), SMS, Email, Push Notifications (mobile app)

**Notification Triggers**

| Event | Patient | Doctor |
|-------|---------|--------|
| Appointment booked | Confirmation + token number | New appointment alert |
| Appointment reminder | 1 hour before | Morning schedule summary |
| Appointment cancelled | Cancellation confirmation | Cancellation alert |
| Token called | "Your turn is next" | — |
| Prescription ready | Prescription PDF link | — |
| Bill generated | Invoice + payment link | — |
| Payment received | Receipt | — |

**Implementation**
- WhatsApp: WhatsApp Business API (via provider like Gupshup/Wati)
- SMS: SMS gateway (MSG91 / Twilio)
- Email: Transactional email (SendGrid / AWS SES)
- Push: Firebase Cloud Messaging (FCM)
- Notification preferences: patients can opt-in/out per channel
- Notification log for audit trail

### 3.6 Walk-ins Management

- Quick patient registration (minimal fields for speed)
- Auto-assign token number per doctor queue
- Priority marking (emergency/senior citizen)
- Queue display with estimated wait times
- Transfer between doctor queues if needed

---

## 4. Platform Specifications

### 4.1 Web Application (Next.js)

**Staff Dashboard (Admin, Doctor, Reception, Nurse)**
- Role-specific dashboards with relevant widgets
- **Admin:** System stats, user management, reports
- **Doctor:** Today's queue, consultation workspace, prescription writer
- **Reception:** Appointment booking, walk-in registration, billing counter
- **Nurse:** Patient vitals entry, OPD prep checklist, queue status
- Responsive design (works on tablets at reception/nurse stations)

**Patient Portal**
- Book/manage appointments
- View prescriptions and medical history
- View and pay bills online
- Profile management

### 4.2 Mobile Application (React Native)

**Patient App**
- Appointment booking and management
- Live queue/token status with push notifications
- Digital prescriptions viewer
- Bill payments
- Profile and medical history

**Staff App (Phase 1 - Doctor focused)**
- Doctor: View queue, quick consultation notes, prescription on-the-go
- Push notifications for new appointments/emergencies

### 4.3 Token Display (Optional)
- Simple web page for TV/monitor at waiting area
- Shows current token number per doctor
- Auto-refreshes via WebSocket

---

## 5. Technical Architecture

### 5.1 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend (Web)** | Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui |
| **Frontend (Mobile)** | React Native (Expo), TypeScript |
| **Backend API** | Node.js, Express.js, TypeScript |
| **Database** | PostgreSQL with Prisma ORM |
| **Auth** | JWT + refresh tokens, bcrypt for passwords |
| **Real-time** | WebSocket (Socket.io) for queue updates, token display |
| **File Storage** | AWS S3 / Cloudinary (prescriptions PDFs, eSign images) |
| **Notifications** | WhatsApp Business API, MSG91/Twilio (SMS), SendGrid (Email), FCM (Push) |
| **Payments** | Razorpay payment gateway |
| **PDF Generation** | Puppeteer or @react-pdf/renderer |
| **Hosting** | AWS / Vercel (web) + Railway/Render (API) |
| **Monitoring** | Sentry (errors), basic health checks |

### 5.2 Project Structure (Monorepo)

```
medcore/
├── apps/
│   ├── web/              # Next.js web application
│   ├── mobile/           # React Native (Expo) app
│   └── api/              # Express.js backend
├── packages/
│   ├── shared/           # Shared types, constants, validation schemas
│   ├── ui/               # Shared UI components (web)
│   └── db/               # Prisma schema, migrations, seed data
├── docs/                 # Documentation
├── turbo.json            # Turborepo config
└── package.json
```

### 5.3 Database Schema (Key Entities)

- **users** — all staff and patients (role-based)
- **doctors** — doctor profiles, specialization
- **doctor_schedules** — weekly availability, slot configuration
- **schedule_overrides** — blocked dates, modified hours
- **patients** — patient demographics, MR number
- **appointments** — bookings with status, slot, token number
- **walk_ins** — walk-in queue entries
- **consultations** — doctor notes per visit
- **vitals** — nurse-entered vitals per visit
- **prescriptions** — prescription header
- **prescription_items** — individual medicines
- **invoices** — billing header
- **invoice_items** — line items
- **payments** — payment transactions
- **insurance_claims** — TPA/insurance tracking
- **notifications** — notification log
- **notification_preferences** — per-patient channel preferences

### 5.4 API Design
- RESTful API with versioning (`/api/v1/...`)
- Standard response format: `{ success, data, error, meta }`
- Pagination: cursor-based for lists
- Rate limiting on public endpoints
- Input validation with Zod schemas (shared with frontend)

---

## 6. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| **Response Time** | API < 200ms (p95), Page load < 2s |
| **Availability** | 99.5% uptime |
| **Concurrent Users** | Support 200+ simultaneous users |
| **Data Retention** | Patient records retained for 5+ years |
| **Security** | HTTPS, encrypted passwords, role-based access, audit logging |
| **Compliance** | HIPAA-aware data handling, prescription eSign validity |
| **Backup** | Daily automated database backups |
| **Mobile** | Support Android 8+ and iOS 14+ |

---

## 7. Phase 1 Deliverables

1. **Web Application** — Staff dashboards (Admin, Doctor, Reception, Nurse) + Patient portal
2. **Mobile App** — Patient app (booking, queue, prescriptions, billing) + Doctor lite app
3. **Backend API** — All core modules (appointments, OPD, billing, prescriptions, notifications)
4. **Notification System** — WhatsApp, SMS, Email, Push integration
5. **Payment Gateway** — Razorpay integration for online payments
6. **Token Display** — Waiting area screen for live queue status

## 8. Phase 2 Scope (Future)

- Indoor/Inpatient management
- Nurse data entry for admitted patients (vitals schedule, medication tracking)
- Medicine database with drug interaction alerts
- Lab test integration
- Inventory management (pharmacy)
- Advanced analytics and reporting dashboard
- Multi-branch support

---

## 9. Success Metrics

- Reduce average patient wait time by 40%
- 70%+ appointments booked online within 3 months
- Zero billing errors with automated invoice generation
- 90%+ prescription delivery rate via digital channels
- Staff adoption: all roles using the system within 2 weeks of launch

---

## Plan: Next Steps

Once this PRD is approved, implementation will proceed as:

1. **Project setup** — Monorepo with Turborepo, configure all apps
2. **Database schema** — Design and create Prisma schema with migrations
3. **Auth system** — User registration, login, role-based access
4. **Core API** — Appointments, patients, OPD workflow, billing, prescriptions
5. **Web app** — Staff dashboards and patient portal
6. **Mobile app** — Patient app and doctor lite app
7. **Integrations** — Notifications (WhatsApp/SMS/Email/Push), Razorpay payments
8. **Testing & QA** — End-to-end testing, load testing for 150+ daily patients
9. **Deployment** — Production setup with monitoring and backups
