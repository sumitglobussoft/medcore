"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/lib/store";
import { api } from "@/lib/api";
import {
  Calendar,
  Users,
  CreditCard,
  Activity,
  BedDouble,
  Siren,
  Droplet,
  Pill,
  FlaskConical,
  Scissors,
  TrendingUp,
  AlertTriangle,
  Package,
  Heart,
  Bell,
  Clock,
  CheckCircle2,
  ArrowRight,
  Syringe,
  FileText,
  Star,
  Video,
  Ambulance as AmbulanceIcon,
  UserCheck,
  Baby,
} from "lucide-react";

interface DashboardData {
  // OPD
  todayAppointments?: number;
  totalPatients?: number;
  pendingBills?: number;
  inQueueCount?: number;
  todayRevenue?: number;
  // IPD
  currentlyAdmitted?: number;
  bedsOccupied?: number;
  totalBeds?: number;
  // Emergency
  erWaiting?: number;
  erCritical?: number;
  // Pharmacy
  lowStockCount?: number;
  // Lab
  pendingLabOrders?: number;
  // Blood bank
  bloodUnitsAvailable?: number;
  bloodUnitsExpiring?: number;
  // Surgery
  surgeriesScheduledToday?: number;
  surgeriesInProgress?: number;
  // HR
  staffOnDuty?: number;
  pendingLeaves?: number;
  // Feedback
  avgRating?: number;
  openComplaints?: number;
  // Immunization
  overdueImmunizations?: number;
  // Medication
  medicationsDue?: number;
  // Telemedicine
  telemedicineToday?: number;
  // Visitors
  activeVisitors?: number;
}

function safeGet<T>(path: string, fallback: T): Promise<T> {
  return api.get<T>(path).catch(() => fallback);
}

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  href,
  subtitle,
  trend,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  href?: string;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
}) {
  const content = (
    <div className="h-full rounded-xl bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {title}
          </p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
          {subtitle && (
            <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
          )}
        </div>
        <div className={`rounded-lg p-2.5 ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function ModuleSection({
  title,
  icon: Icon,
  iconColor,
  children,
  viewAllHref,
}: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  children: React.ReactNode;
  viewAllHref?: string;
}) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`rounded-lg p-1.5 ${iconColor}`}>
            <Icon size={16} className="text-white" />
          </div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            View all <ArrowRight size={12} />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [data, setData] = useState<DashboardData>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split("T")[0];

      const [
        appointments,
        patients,
        pendingInv,
        partialInv,
        queue,
        admissions,
        wards,
        emergencyActive,
        lowStock,
        labOrders,
        bloodInventory,
        surgeryScheduled,
        surgeryInProgress,
        rosterToday,
        pendingLeaves,
        feedbackSummary,
        openComplaints,
        overview,
        medsDue,
        telemed,
        immunSchedule,
        visitorsActive,
      ] = await Promise.all([
        safeGet<any>(`/appointments?date=${today}&limit=1`, { meta: { total: 0 } }),
        safeGet<any>(`/patients?limit=1`, { meta: { total: 0 } }),
        safeGet<any>(`/billing/invoices?status=PENDING&limit=1`, { meta: { total: 0 } }),
        safeGet<any>(`/billing/invoices?status=PARTIAL&limit=1`, { meta: { total: 0 } }),
        safeGet<any>(`/queue`, { data: [] }),
        safeGet<any>(`/admissions?status=ADMITTED&limit=1`, { meta: { total: 0 } }),
        safeGet<any>(`/wards`, { data: [] }),
        safeGet<any>(`/emergency/cases/active`, { data: [] }),
        safeGet<any>(`/pharmacy/inventory?lowStock=true&limit=1`, { meta: { total: 0 } }),
        safeGet<any>(`/lab/orders?status=ORDERED&limit=1`, { meta: { total: 0 } }),
        safeGet<any>(`/bloodbank/inventory/summary`, { data: null }),
        safeGet<any>(`/surgery?status=SCHEDULED&from=${today}&to=${today}&limit=1`, { meta: { total: 0 } }),
        safeGet<any>(`/surgery?status=IN_PROGRESS&limit=1`, { meta: { total: 0 } }),
        safeGet<any>(`/shifts/roster?date=${today}`, { data: [] }),
        safeGet<any>(`/leaves/pending`, { data: [] }),
        safeGet<any>(`/feedback/summary`, { data: null }),
        safeGet<any>(`/complaints?status=OPEN&limit=1`, { meta: { total: 0 } }),
        safeGet<any>(`/analytics/overview?from=${today}&to=${today}`, { data: null }),
        safeGet<any>(`/medication/administrations/due`, { data: [] }),
        safeGet<any>(`/telemedicine?date=${today}&limit=1`, { meta: { total: 0 } }),
        safeGet<any>(`/ehr/immunizations/schedule?filter=overdue`, { data: [] }),
        safeGet<any>(`/visitors/active`, { data: [] }),
      ]);

      // Compute totals
      const totalInQueue = (queue.data ?? []).reduce(
        (sum: number, doc: any) => sum + (doc.waitingCount || 0),
        0
      );

      const wardStats = (wards.data ?? []).reduce(
        (acc: any, w: any) => {
          const total = w.beds?.length || w.totalBeds || 0;
          const occupied = w.beds?.filter((b: any) => b.status === "OCCUPIED").length ?? w.occupiedBeds ?? 0;
          acc.total += total;
          acc.occupied += occupied;
          return acc;
        },
        { total: 0, occupied: 0 }
      );

      const bloodSummary = bloodInventory.data;
      const bloodAvailable = bloodSummary?.totalAvailable ?? bloodSummary?.total ?? 0;
      const bloodExpiring = bloodSummary?.expiringSoon ?? 0;

      const erCases = emergencyActive.data ?? [];
      const erCritical = erCases.filter(
        (c: any) => c.triageLevel === "RESUSCITATION" || c.triageLevel === "EMERGENT"
      ).length;

      const todayRevenue = overview.data?.totalRevenue ?? 0;

      setData({
        todayAppointments: appointments.meta?.total ?? 0,
        totalPatients: patients.meta?.total ?? 0,
        pendingBills: (pendingInv.meta?.total ?? 0) + (partialInv.meta?.total ?? 0),
        inQueueCount: totalInQueue,
        todayRevenue,
        currentlyAdmitted: admissions.meta?.total ?? 0,
        bedsOccupied: wardStats.occupied,
        totalBeds: wardStats.total,
        erWaiting: erCases.length,
        erCritical,
        lowStockCount: lowStock.meta?.total ?? 0,
        pendingLabOrders: labOrders.meta?.total ?? 0,
        bloodUnitsAvailable: bloodAvailable,
        bloodUnitsExpiring: bloodExpiring,
        surgeriesScheduledToday: surgeryScheduled.meta?.total ?? 0,
        surgeriesInProgress: surgeryInProgress.meta?.total ?? 0,
        staffOnDuty: (rosterToday.data ?? []).length,
        pendingLeaves: (pendingLeaves.data ?? []).length,
        avgRating: feedbackSummary.data?.avgRating ?? 0,
        openComplaints: openComplaints.meta?.total ?? 0,
        overdueImmunizations: (immunSchedule.data ?? []).length,
        medicationsDue: (medsDue.data ?? []).length,
        telemedicineToday: telemed.meta?.total ?? 0,
        activeVisitors: (visitorsActive.data ?? []).length,
      });
      setLoading(false);
    }
    load().catch(() => setLoading(false));
  }, []);

  const role = user?.role;
  const isAdmin = role === "ADMIN";
  const isDoctor = role === "DOCTOR";
  const isNurse = role === "NURSE";
  const isReception = role === "RECEPTION";
  const isPatient = role === "PATIENT";

  const fmt = (n?: number) => (n ?? 0).toLocaleString("en-IN");
  const money = (n?: number) =>
    `Rs. ${(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome, {user?.name}
          </h1>
          <p className="text-sm text-gray-500">
            {new Date().toLocaleDateString("en-IN", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        {role && (
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            {role}
          </span>
        )}
      </div>

      {loading && (
        <div className="mb-6 rounded-xl bg-white p-6 text-center text-gray-400 shadow-sm">
          Loading dashboard data...
        </div>
      )}

      {/* Patient-specific view */}
      {isPatient && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="My Appointments"
            value={fmt(data.todayAppointments)}
            icon={Calendar}
            color="bg-primary"
            href="/dashboard/appointments"
          />
          <StatCard
            title="Prescriptions"
            value={fmt(data.pendingBills)}
            icon={FileText}
            color="bg-secondary"
            href="/dashboard/prescriptions"
          />
          <StatCard
            title="Pending Bills"
            value={fmt(data.pendingBills)}
            icon={CreditCard}
            color="bg-accent"
            href="/dashboard/billing"
          />
          <StatCard
            title="Notifications"
            value="-"
            icon={Bell}
            color="bg-purple-600"
            href="/dashboard/notifications"
          />
        </div>
      )}

      {!isPatient && (
        <>
          {/* Top KPI strip */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard
              title="Today's Appts"
              value={fmt(data.todayAppointments)}
              subtitle={`${data.inQueueCount ?? 0} in queue`}
              icon={Calendar}
              color="bg-primary"
              href="/dashboard/appointments"
            />
            <StatCard
              title="Patients"
              value={fmt(data.totalPatients)}
              icon={Users}
              color="bg-secondary"
              href="/dashboard/patients"
            />
            <StatCard
              title="Today Revenue"
              value={money(data.todayRevenue)}
              icon={TrendingUp}
              color="bg-emerald-600"
              href="/dashboard/reports"
            />
            <StatCard
              title="Beds Occupied"
              value={`${fmt(data.bedsOccupied)}/${fmt(data.totalBeds)}`}
              subtitle={
                data.totalBeds
                  ? `${Math.round((data.bedsOccupied! / data.totalBeds) * 100)}% occupancy`
                  : undefined
              }
              icon={BedDouble}
              color="bg-indigo-600"
              href="/dashboard/wards"
            />
            <StatCard
              title="ER Active"
              value={fmt(data.erWaiting)}
              subtitle={
                data.erCritical ? `${data.erCritical} critical` : "None critical"
              }
              icon={Siren}
              color={data.erCritical ? "bg-red-600" : "bg-orange-600"}
              href="/dashboard/emergency"
            />
            <StatCard
              title="Pending Bills"
              value={fmt(data.pendingBills)}
              icon={CreditCard}
              color="bg-accent"
              href="/dashboard/billing"
            />
          </div>

          {/* Role-specific primary sections */}
          {(isDoctor || isAdmin) && (
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <ModuleSection
                title="Clinical — Today"
                icon={Activity}
                iconColor="bg-primary"
                viewAllHref="/dashboard/queue"
              >
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2">
                    <span className="text-gray-700">In Queue</span>
                    <span className="font-bold text-primary">
                      {fmt(data.inQueueCount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-indigo-50 px-3 py-2">
                    <span className="text-gray-700">Admitted</span>
                    <span className="font-bold text-indigo-700">
                      {fmt(data.currentlyAdmitted)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-purple-50 px-3 py-2">
                    <span className="text-gray-700">Telemedicine Today</span>
                    <span className="font-bold text-purple-700">
                      {fmt(data.telemedicineToday)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2">
                    <span className="text-gray-700">Surgeries Today</span>
                    <span className="font-bold text-green-700">
                      {fmt(data.surgeriesScheduledToday)} scheduled,{" "}
                      {fmt(data.surgeriesInProgress)} active
                    </span>
                  </div>
                </div>
              </ModuleSection>

              <ModuleSection
                title="Diagnostics & Labs"
                icon={FlaskConical}
                iconColor="bg-teal-600"
                viewAllHref="/dashboard/lab"
              >
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700">Pending Lab Orders</span>
                    <span className="font-bold">{fmt(data.pendingLabOrders)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700">Blood Units Available</span>
                    <Link href="/dashboard/bloodbank" className="font-bold text-red-600">
                      {fmt(data.bloodUnitsAvailable)}
                    </Link>
                  </div>
                  {!!data.bloodUnitsExpiring && (
                    <div className="mt-1 flex items-center gap-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                      <AlertTriangle size={14} />
                      {data.bloodUnitsExpiring} blood unit(s) expiring soon
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700">Overdue Immunizations</span>
                    <Link href="/dashboard/immunization-schedule" className="font-bold text-orange-600">
                      {fmt(data.overdueImmunizations)}
                    </Link>
                  </div>
                </div>
              </ModuleSection>

              <ModuleSection
                title="Operations"
                icon={Package}
                iconColor="bg-amber-600"
                viewAllHref="/dashboard/pharmacy"
              >
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700">Low Stock Items</span>
                    <Link
                      href="/dashboard/pharmacy"
                      className={`font-bold ${data.lowStockCount ? "text-red-600" : "text-green-600"}`}
                    >
                      {fmt(data.lowStockCount)}
                    </Link>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700">Staff On Duty</span>
                    <Link href="/dashboard/duty-roster" className="font-bold">
                      {fmt(data.staffOnDuty)}
                    </Link>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700">Active Visitors</span>
                    <Link href="/dashboard/visitors" className="font-bold">
                      {fmt(data.activeVisitors)}
                    </Link>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700">Open Complaints</span>
                    <Link
                      href="/dashboard/complaints"
                      className={`font-bold ${data.openComplaints ? "text-red-600" : "text-green-600"}`}
                    >
                      {fmt(data.openComplaints)}
                    </Link>
                  </div>
                </div>
              </ModuleSection>
            </div>
          )}

          {/* Nurse dashboard emphasis */}
          {isNurse && (
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ModuleSection
                title="Medications Due"
                icon={Pill}
                iconColor="bg-pink-600"
                viewAllHref="/dashboard/medication-dashboard"
              >
                <p className="text-3xl font-bold text-pink-700">
                  {fmt(data.medicationsDue)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  scheduled in the next 30 minutes
                </p>
              </ModuleSection>

              <ModuleSection
                title="Emergency Queue"
                icon={Siren}
                iconColor="bg-red-600"
                viewAllHref="/dashboard/emergency"
              >
                <p className="text-3xl font-bold text-red-700">
                  {fmt(data.erWaiting)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {data.erCritical ?? 0} critical awaiting triage
                </p>
              </ModuleSection>

              <ModuleSection
                title="Admitted Patients"
                icon={BedDouble}
                iconColor="bg-indigo-600"
                viewAllHref="/dashboard/admissions"
              >
                <p className="text-3xl font-bold text-indigo-700">
                  {fmt(data.currentlyAdmitted)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {data.bedsOccupied}/{data.totalBeds} beds occupied
                </p>
              </ModuleSection>

              <ModuleSection
                title="Overdue Immunizations"
                icon={Syringe}
                iconColor="bg-orange-600"
                viewAllHref="/dashboard/immunization-schedule"
              >
                <p className="text-3xl font-bold text-orange-700">
                  {fmt(data.overdueImmunizations)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  patients need follow-up
                </p>
              </ModuleSection>
            </div>
          )}

          {/* Reception emphasis */}
          {isReception && (
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <ModuleSection
                title="Pending Billing"
                icon={CreditCard}
                iconColor="bg-accent"
                viewAllHref="/dashboard/billing"
              >
                <p className="text-3xl font-bold text-amber-700">
                  {fmt(data.pendingBills)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  unpaid invoices
                </p>
              </ModuleSection>

              <ModuleSection
                title="Today's Queue"
                icon={Activity}
                iconColor="bg-primary"
                viewAllHref="/dashboard/queue"
              >
                <p className="text-3xl font-bold text-primary">
                  {fmt(data.inQueueCount)}
                </p>
                <p className="mt-1 text-xs text-gray-500">patients waiting</p>
              </ModuleSection>

              <ModuleSection
                title="Visitors"
                icon={UserCheck}
                iconColor="bg-purple-600"
                viewAllHref="/dashboard/visitors"
              >
                <p className="text-3xl font-bold text-purple-700">
                  {fmt(data.activeVisitors)}
                </p>
                <p className="mt-1 text-xs text-gray-500">currently in-building</p>
              </ModuleSection>
            </div>
          )}

          {/* Admin summary — deeper financial & operational section */}
          {isAdmin && (
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-4">
              <StatCard
                title="Surgeries In Progress"
                value={fmt(data.surgeriesInProgress)}
                icon={Scissors}
                color="bg-red-600"
                href="/dashboard/surgery"
              />
              <StatCard
                title="Patient Rating"
                value={
                  data.avgRating
                    ? `${data.avgRating.toFixed(1)} ★`
                    : "N/A"
                }
                icon={Star}
                color="bg-yellow-500"
                href="/dashboard/feedback"
              />
              <StatCard
                title="Telemedicine"
                value={fmt(data.telemedicineToday)}
                subtitle="scheduled today"
                icon={Video}
                color="bg-purple-600"
                href="/dashboard/telemedicine"
              />
              <StatCard
                title="Pending Leaves"
                value={fmt(data.pendingLeaves)}
                icon={Clock}
                color="bg-blue-600"
                href="/dashboard/leave-management"
              />
            </div>
          )}

          {/* Quick Actions by role */}
          <div className="mt-8">
            <h2 className="mb-4 text-base font-semibold text-gray-900">
              Quick Actions
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {(isReception || isAdmin) && (
                <>
                  <QuickAction href="/dashboard/walk-in" icon={Users} label="Walk-in" />
                  <QuickAction href="/dashboard/appointments" icon={Calendar} label="Book Appt" />
                  <QuickAction href="/dashboard/billing" icon={CreditCard} label="Bills" />
                  <QuickAction href="/dashboard/visitors" icon={UserCheck} label="Check-in Visitor" />
                  <QuickAction href="/dashboard/emergency" icon={Siren} label="ER Intake" />
                  <QuickAction href="/dashboard/ambulance" icon={AmbulanceIcon} label="Dispatch Ambulance" />
                </>
              )}
              {isDoctor && (
                <>
                  <QuickAction href="/dashboard/queue" icon={Activity} label="My Queue" />
                  <QuickAction href="/dashboard/prescriptions" icon={FileText} label="Prescriptions" />
                  <QuickAction href="/dashboard/telemedicine" icon={Video} label="Telemedicine" />
                  <QuickAction href="/dashboard/lab" icon={FlaskConical} label="Order Labs" />
                  <QuickAction href="/dashboard/surgery" icon={Scissors} label="Schedule Surgery" />
                  <QuickAction href="/dashboard/referrals" icon={Heart} label="Refer Patient" />
                </>
              )}
              {isNurse && (
                <>
                  <QuickAction href="/dashboard/vitals" icon={Activity} label="Record Vitals" />
                  <QuickAction href="/dashboard/medication-dashboard" icon={Pill} label="Medications" />
                  <QuickAction href="/dashboard/emergency" icon={Siren} label="ER Triage" />
                  <QuickAction href="/dashboard/admissions" icon={BedDouble} label="Admissions" />
                  <QuickAction href="/dashboard/bloodbank" icon={Droplet} label="Blood Bank" />
                  <QuickAction href="/dashboard/immunization-schedule" icon={Syringe} label="Immunizations" />
                </>
              )}
              {isAdmin && (
                <>
                  <QuickAction href="/dashboard/analytics" icon={TrendingUp} label="Analytics" />
                  <QuickAction href="/dashboard/reports" icon={FileText} label="Reports" />
                  <QuickAction href="/dashboard/users" icon={Users} label="Users" />
                  <QuickAction href="/dashboard/expenses" icon={CreditCard} label="Expenses" />
                  <QuickAction href="/dashboard/purchase-orders" icon={Package} label="POs" />
                  <QuickAction href="/dashboard/audit" icon={CheckCircle2} label="Audit Log" />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 p-4 text-center transition hover:border-primary hover:bg-blue-50"
    >
      <Icon className="text-primary" size={24} />
      <span className="text-xs font-medium text-gray-700">{label}</span>
    </Link>
  );
}
