"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/store";
import { useThemeStore } from "@/lib/theme";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import {
  LayoutDashboard,
  Calendar,
  Users,
  UserPlus,
  CreditCard,
  FileText,
  Activity,
  Monitor,
  LogOut,
  Stethoscope,
  BarChart3,
  UserCog,
  CalendarClock,
  Bell,
  Shield,
  TrendingUp,
  Hotel,
  BedDouble,
  Syringe,
  Pill,
  Package,
  FlaskConical,
  ArrowRightLeft,
  Scissors,
  Building,
  Gift,
  Truck,
  ShoppingCart,
  Wallet,
  CalendarDays,
  Users2,
  PlaneTakeoff,
  Baby,
  LineChart,
  Droplet,
  Ambulance,
  Wrench,
  Video,
  Siren,
  Star,
  AlertTriangle,
  MessageCircle,
  UserCheck,
  Undo2,
  Search,
  CalendarRange,
  Briefcase,
  PiggyBank,
  Megaphone,
  CalendarOff,
  ShieldAlert,
  Sun,
  Moon,
  Keyboard,
  Award,
  ClipboardList,
  FileCheck,
  Percent,
  Clock,
} from "lucide-react";
import clsx from "clsx";
import { SearchPalette } from "./_components/search-palette";

const navByRole: Record<
  string,
  Array<{ href: string; label: string; icon: React.ElementType }>
> = {
  ADMIN: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/dashboard/admin-console", label: "Admin Console", icon: LayoutDashboard },
    { href: "/dashboard/calendar", label: "Calendar", icon: CalendarRange },
    { href: "/dashboard/appointments", label: "Appointments", icon: Calendar },
    { href: "/dashboard/patients", label: "Patients", icon: Users },
    { href: "/dashboard/queue", label: "Queue", icon: Monitor },
    { href: "/dashboard/wards", label: "Wards", icon: Hotel },
    { href: "/dashboard/admissions", label: "Admissions", icon: BedDouble },
    { href: "/dashboard/medicines", label: "Medicines", icon: Pill },
    { href: "/dashboard/pharmacy", label: "Pharmacy", icon: Package },
    { href: "/dashboard/lab", label: "Lab", icon: FlaskConical },
    { href: "/dashboard/lab/qc", label: "Lab QC", icon: Activity },
    { href: "/dashboard/controlled-substances", label: "Controlled Register", icon: ShieldAlert },
    { href: "/dashboard/immunization-schedule", label: "Immunizations", icon: Syringe },
    { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
    { href: "/dashboard/refunds", label: "Refunds", icon: Undo2 },
    { href: "/dashboard/payment-plans", label: "Payment Plans", icon: CreditCard },
    { href: "/dashboard/preauth", label: "Pre-Authorization", icon: FileCheck },
    { href: "/dashboard/discount-approvals", label: "Discount Approvals", icon: Percent },
    { href: "/dashboard/packages", label: "Packages", icon: Gift },
    { href: "/dashboard/suppliers", label: "Suppliers", icon: Truck },
    { href: "/dashboard/purchase-orders", label: "Purchase Orders", icon: ShoppingCart },
    { href: "/dashboard/expenses", label: "Expenses", icon: Wallet },
    { href: "/dashboard/prescriptions", label: "Prescriptions", icon: FileText },
    { href: "/dashboard/doctors", label: "Doctors", icon: Stethoscope },
    { href: "/dashboard/referrals", label: "Referrals", icon: ArrowRightLeft },
    { href: "/dashboard/surgery", label: "Surgery", icon: Scissors },
    { href: "/dashboard/ot", label: "OTs", icon: Building },
    { href: "/dashboard/antenatal", label: "Antenatal", icon: Baby },
    { href: "/dashboard/pediatric", label: "Pediatric", icon: LineChart },
    { href: "/dashboard/bloodbank", label: "Blood Bank", icon: Droplet },
    { href: "/dashboard/ambulance", label: "Ambulance", icon: Ambulance },
    { href: "/dashboard/assets", label: "Assets", icon: Wrench },
    { href: "/dashboard/telemedicine", label: "Telemedicine", icon: Video },
    { href: "/dashboard/emergency", label: "Emergency", icon: Siren },
    { href: "/dashboard/users", label: "Users", icon: UserCog },
    { href: "/dashboard/duty-roster", label: "Duty Roster", icon: Users2 },
    { href: "/dashboard/leave-management", label: "Leave Requests", icon: PlaneTakeoff },
    { href: "/dashboard/leave-calendar", label: "Leave Calendar", icon: CalendarDays },
    { href: "/dashboard/holidays", label: "Holidays", icon: CalendarOff },
    { href: "/dashboard/payroll", label: "Payroll", icon: Wallet },
    { href: "/dashboard/certifications", label: "Certifications", icon: Award },
    { href: "/dashboard/census", label: "Census Report", icon: ClipboardList },
    { href: "/dashboard/budgets", label: "Budgets", icon: PiggyBank },
    { href: "/dashboard/broadcasts", label: "Broadcasts", icon: Megaphone },
    { href: "/dashboard/schedule", label: "Schedule", icon: CalendarClock },
    { href: "/dashboard/reports", label: "Reports", icon: BarChart3 },
    { href: "/dashboard/scheduled-reports", label: "Scheduled Reports", icon: Clock },
    { href: "/dashboard/analytics", label: "Analytics", icon: TrendingUp },
    { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
    { href: "/dashboard/audit", label: "Audit Log", icon: Shield },
    { href: "/dashboard/feedback", label: "Feedback", icon: Star },
    { href: "/dashboard/complaints", label: "Complaints", icon: AlertTriangle },
    { href: "/dashboard/chat", label: "Chat", icon: MessageCircle },
    { href: "/dashboard/visitors", label: "Visitors", icon: UserCheck },
  ],
  DOCTOR: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/dashboard/workspace", label: "Workspace", icon: Briefcase },
    { href: "/dashboard/calendar", label: "Calendar", icon: CalendarRange },
    { href: "/dashboard/queue", label: "My Queue", icon: Monitor },
    { href: "/dashboard/appointments", label: "Appointments", icon: Calendar },
    { href: "/dashboard/admissions", label: "Admissions", icon: BedDouble },
    { href: "/dashboard/prescriptions", label: "Prescriptions", icon: FileText },
    { href: "/dashboard/patients", label: "Patients", icon: Users },
    { href: "/dashboard/medicines", label: "Medicines", icon: Pill },
    { href: "/dashboard/lab", label: "Lab", icon: FlaskConical },
    { href: "/dashboard/immunization-schedule", label: "Immunizations", icon: Syringe },
    { href: "/dashboard/referrals", label: "Referrals", icon: ArrowRightLeft },
    { href: "/dashboard/surgery", label: "Surgery", icon: Scissors },
    { href: "/dashboard/antenatal", label: "Antenatal", icon: Baby },
    { href: "/dashboard/pediatric", label: "Pediatric", icon: LineChart },
    { href: "/dashboard/bloodbank", label: "Blood Bank", icon: Droplet },
    { href: "/dashboard/telemedicine", label: "Telemedicine", icon: Video },
    { href: "/dashboard/emergency", label: "Emergency", icon: Siren },
    { href: "/dashboard/chat", label: "Chat", icon: MessageCircle },
    { href: "/dashboard/schedule", label: "Schedule", icon: CalendarClock },
    { href: "/dashboard/my-schedule", label: "My Schedule", icon: CalendarDays },
    { href: "/dashboard/my-leaves", label: "My Leaves", icon: PlaneTakeoff },
    { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
  ],
  RECEPTION: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/dashboard/calendar", label: "Calendar", icon: CalendarRange },
    { href: "/dashboard/appointments", label: "Appointments", icon: Calendar },
    { href: "/dashboard/walk-in", label: "Walk-in", icon: UserPlus },
    { href: "/dashboard/patients", label: "Patients", icon: Users },
    { href: "/dashboard/queue", label: "Queue", icon: Monitor },
    { href: "/dashboard/wards", label: "Wards", icon: Hotel },
    { href: "/dashboard/admissions", label: "Admissions", icon: BedDouble },
    { href: "/dashboard/pharmacy", label: "Pharmacy", icon: Package },
    { href: "/dashboard/controlled-substances", label: "Controlled Register", icon: ShieldAlert },
    { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
    { href: "/dashboard/refunds", label: "Refunds", icon: Undo2 },
    { href: "/dashboard/payment-plans", label: "Payment Plans", icon: CreditCard },
    { href: "/dashboard/preauth", label: "Pre-Authorization", icon: FileCheck },
    { href: "/dashboard/packages", label: "Packages", icon: Gift },
    { href: "/dashboard/purchase-orders", label: "Purchase Orders", icon: ShoppingCart },
    { href: "/dashboard/expenses", label: "Expenses", icon: Wallet },
    { href: "/dashboard/telemedicine", label: "Telemedicine", icon: Video },
    { href: "/dashboard/emergency", label: "Emergency", icon: Siren },
    { href: "/dashboard/ambulance", label: "Ambulance", icon: Ambulance },
    { href: "/dashboard/reports", label: "Reports", icon: BarChart3 },
    { href: "/dashboard/feedback", label: "Feedback", icon: Star },
    { href: "/dashboard/complaints", label: "Complaints", icon: AlertTriangle },
    { href: "/dashboard/chat", label: "Chat", icon: MessageCircle },
    { href: "/dashboard/visitors", label: "Visitors", icon: UserCheck },
    { href: "/dashboard/my-schedule", label: "My Schedule", icon: CalendarDays },
    { href: "/dashboard/my-leaves", label: "My Leaves", icon: PlaneTakeoff },
    { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
  ],
  NURSE: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/dashboard/workstation", label: "Workstation", icon: Activity },
    { href: "/dashboard/calendar", label: "Calendar", icon: CalendarRange },
    { href: "/dashboard/queue", label: "Queue", icon: Monitor },
    { href: "/dashboard/wards", label: "Wards", icon: Hotel },
    { href: "/dashboard/admissions", label: "Admissions", icon: BedDouble },
    { href: "/dashboard/medication-dashboard", label: "Medication", icon: Syringe },
    { href: "/dashboard/lab", label: "Lab", icon: FlaskConical },
    { href: "/dashboard/immunization-schedule", label: "Immunizations", icon: Syringe },
    { href: "/dashboard/surgery", label: "Surgery", icon: Scissors },
    { href: "/dashboard/antenatal", label: "Antenatal", icon: Baby },
    { href: "/dashboard/pediatric", label: "Pediatric", icon: LineChart },
    { href: "/dashboard/vitals", label: "Vitals", icon: Activity },
    { href: "/dashboard/emergency", label: "Emergency", icon: Siren },
    { href: "/dashboard/bloodbank", label: "Blood Bank", icon: Droplet },
    { href: "/dashboard/ambulance", label: "Ambulance", icon: Ambulance },
    { href: "/dashboard/patients", label: "Patients", icon: Users },
    { href: "/dashboard/chat", label: "Chat", icon: MessageCircle },
    { href: "/dashboard/my-schedule", label: "My Schedule", icon: CalendarDays },
    { href: "/dashboard/my-leaves", label: "My Leaves", icon: PlaneTakeoff },
    { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
  ],
  PATIENT: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/dashboard/calendar", label: "Calendar", icon: CalendarRange },
    { href: "/dashboard/appointments", label: "My Appointments", icon: Calendar },
    { href: "/dashboard/telemedicine", label: "Telemedicine", icon: Video },
    { href: "/dashboard/prescriptions", label: "Prescriptions", icon: FileText },
    { href: "/dashboard/billing", label: "Bills", icon: CreditCard },
    { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
  ],
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, loadSession, logout } = useAuthStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const resolvedTheme = useThemeStore((s) => s.resolved);
  const toggleTheme = useThemeStore((s) => s.toggle);

  // Track multi-key sequences (e.g. "g h" for go home)
  const seqRef = useRef<{ key: string; ts: number } | null>(null);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  // Keyboard shortcuts
  useEffect(() => {
    function isTyping(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (el.isContentEditable ?? false)
      );
    }

    function onKey(e: KeyboardEvent) {
      // Ctrl+K / Cmd+K — search
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }

      // Esc — close modals
      if (e.key === "Escape") {
        if (shortcutsOpen) setShortcutsOpen(false);
        if (searchOpen) setSearchOpen(false);
        return;
      }

      if (isTyping()) return;

      // ? — help
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      // n — new (context-aware)
      if (e.key === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (pathname.includes("/appointments")) {
          // Navigate to appointments booking — we just route there; the page handles showing booking panel
          router.push("/dashboard/appointments");
          return;
        }
        if (pathname.includes("/patients")) {
          router.push("/dashboard/patients");
          return;
        }
      }

      // Sequence shortcuts: "g" then [h|a|p|q]
      const now = Date.now();
      if (e.key === "g") {
        seqRef.current = { key: "g", ts: now };
        return;
      }
      if (
        seqRef.current &&
        seqRef.current.key === "g" &&
        now - seqRef.current.ts < 2000
      ) {
        const k = e.key.toLowerCase();
        if (k === "h") {
          router.push("/dashboard");
          seqRef.current = null;
          e.preventDefault();
          return;
        }
        if (k === "a") {
          router.push("/dashboard/appointments");
          seqRef.current = null;
          e.preventDefault();
          return;
        }
        if (k === "p") {
          router.push("/dashboard/patients");
          seqRef.current = null;
          e.preventDefault();
          return;
        }
        if (k === "q") {
          router.push("/dashboard/queue");
          seqRef.current = null;
          e.preventDefault();
          return;
        }
        seqRef.current = null;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname, router, shortcutsOpen, searchOpen]);

  if (isLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg dark:bg-gray-900">
        <p className="text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  const nav = navByRole[user.role] || navByRole.PATIENT;

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside
        className="no-print flex w-64 flex-col bg-sidebar text-white"
        aria-label="Primary navigation"
      >
        <div className="border-b border-white/10 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">MedCore</h1>
              <p className="mt-1 text-xs text-gray-400">
                {user.name} ({user.role})
              </p>
            </div>
            <button
              onClick={() => setSearchOpen(true)}
              title="Search (Ctrl+K)"
              aria-label="Open search (Ctrl+K)"
              className="rounded-lg p-2 text-gray-300 transition hover:bg-sidebar-hover hover:text-white focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-sidebar focus:outline-none"
            >
              <Search size={18} aria-hidden="true" />
            </button>
          </div>
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="mt-3 flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10 focus:ring-2 focus:ring-primary focus:outline-none"
          >
            <Search size={13} aria-hidden="true" /> Search...
            <kbd className="ml-auto rounded bg-black/30 px-1 py-0.5 text-[10px]">
              Ctrl K
            </kbd>
          </button>
        </div>

        <nav
          className="flex-1 overflow-y-auto p-3"
          aria-label="Main menu"
        >
          {nav.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={clsx(
                  "mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-sidebar",
                  isActive
                    ? "bg-primary font-medium text-white"
                    : "text-gray-300 hover:bg-sidebar-hover hover:text-white"
                )}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 border-t border-white/10 p-3">
          <button
            onClick={toggleTheme}
            aria-label={
              resolvedTheme === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            title={
              resolvedTheme === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            className="rounded-lg p-2 text-gray-300 transition hover:bg-sidebar-hover hover:text-white focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-sidebar focus:outline-none"
          >
            {resolvedTheme === "dark" ? (
              <Sun size={18} aria-hidden="true" />
            ) : (
              <Moon size={18} aria-hidden="true" />
            )}
          </button>
          <button
            onClick={() => setShortcutsOpen(true)}
            aria-label="Show keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className="rounded-lg p-2 text-gray-300 transition hover:bg-sidebar-hover hover:text-white focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-sidebar focus:outline-none"
          >
            <Keyboard size={18} aria-hidden="true" />
          </button>
          <button
            onClick={() => {
              logout();
              router.push("/login");
            }}
            aria-label="Sign out"
            className="ml-auto flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-sidebar-hover hover:text-white focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-sidebar focus:outline-none"
          >
            <LogOut size={16} aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main
        id="main-content"
        className="flex-1 overflow-y-auto bg-bg dark:bg-gray-900"
      >
        <div className="p-6">{children}</div>
      </main>

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
