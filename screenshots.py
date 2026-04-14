"""
Take screenshots of every MedCore module using Playwright.
Groups pages by role to minimize re-logins.
"""
import os
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError

os.environ["PYTHONIOENCODING"] = "utf-8"
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_URL = "https://medcore.globusdemos.com"

CREDS = {
    "admin": ("admin@medcore.local", "admin123"),
    "doctor": ("dr.sharma@medcore.local", "doctor123"),
    "nurse": ("nurse@medcore.local", "nurse123"),
}

OUTPUT_DIR = Path(__file__).parent / "docs" / "screenshots"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Group pages by role, preserve numbered ordering for display
PUBLIC_PAGES = [
    ("00-login", "/login"),
    ("01-register", "/register"),
    ("02-forgot-password", "/forgot-password"),
    ("13-display-token", "/display"),
]

ADMIN_PAGES = [
    ("03-dashboard-admin", "/dashboard"),
    ("06-admin-console", "/dashboard/admin-console"),
    ("07-calendar", "/dashboard/calendar"),
    ("10-appointments", "/dashboard/appointments"),
    ("11-walk-in", "/dashboard/walk-in"),
    ("12-queue", "/dashboard/queue"),
    ("14-patients-list", "/dashboard/patients"),
    ("15-immunization-schedule", "/dashboard/immunization-schedule"),
    ("18-controlled-substances", "/dashboard/controlled-substances"),
    ("19-wards", "/dashboard/wards"),
    ("20-admissions", "/dashboard/admissions"),
    ("22-census", "/dashboard/census"),
    ("23-emergency", "/dashboard/emergency"),
    ("24-surgery", "/dashboard/surgery"),
    ("25-ot", "/dashboard/ot"),
    ("26-telemedicine", "/dashboard/telemedicine"),
    ("30-medicines", "/dashboard/medicines"),
    ("31-pharmacy", "/dashboard/pharmacy"),
    ("32-lab", "/dashboard/lab"),
    ("33-lab-qc", "/dashboard/lab/qc"),
    ("34-bloodbank", "/dashboard/bloodbank"),
    ("35-ambulance", "/dashboard/ambulance"),
    ("36-assets", "/dashboard/assets"),
    ("37-billing", "/dashboard/billing"),
    ("38-refunds", "/dashboard/refunds"),
    ("39-payment-plans", "/dashboard/payment-plans"),
    ("40-preauth", "/dashboard/preauth"),
    ("41-discount-approvals", "/dashboard/discount-approvals"),
    ("42-packages", "/dashboard/packages"),
    ("43-suppliers", "/dashboard/suppliers"),
    ("44-purchase-orders", "/dashboard/purchase-orders"),
    ("45-expenses", "/dashboard/expenses"),
    ("46-budgets", "/dashboard/budgets"),
    ("47-duty-roster", "/dashboard/duty-roster"),
    ("49-leave-management", "/dashboard/leave-management"),
    ("51-leave-calendar", "/dashboard/leave-calendar"),
    ("52-holidays", "/dashboard/holidays"),
    ("53-payroll", "/dashboard/payroll"),
    ("54-certifications", "/dashboard/certifications"),
    ("55-users", "/dashboard/users"),
    ("56-doctors", "/dashboard/doctors"),
    ("57-schedule", "/dashboard/schedule"),
    ("58-reports", "/dashboard/reports"),
    ("59-analytics", "/dashboard/analytics"),
    ("60-scheduled-reports", "/dashboard/scheduled-reports"),
    ("61-audit", "/dashboard/audit"),
    ("62-notifications", "/dashboard/notifications"),
    ("63-broadcasts", "/dashboard/broadcasts"),
    ("64-feedback", "/dashboard/feedback"),
    ("65-complaints", "/dashboard/complaints"),
    ("66-chat", "/dashboard/chat"),
    ("67-visitors", "/dashboard/visitors"),
]

DOCTOR_PAGES = [
    ("04-dashboard-doctor", "/dashboard"),
    ("08-workspace-doctor", "/dashboard/workspace"),
    ("17-prescriptions", "/dashboard/prescriptions"),
    ("27-antenatal", "/dashboard/antenatal"),
    ("28-pediatric", "/dashboard/pediatric"),
    ("29-referrals", "/dashboard/referrals"),
    ("48-my-schedule", "/dashboard/my-schedule"),
    ("50-my-leaves", "/dashboard/my-leaves"),
]

NURSE_PAGES = [
    ("05-dashboard-nurse", "/dashboard"),
    ("09-workstation-nurse", "/dashboard/workstation"),
    ("16-vitals", "/dashboard/vitals"),
    ("21-medication-dashboard", "/dashboard/medication-dashboard"),
]


def login(page, email, password):
    """Login and verify dashboard loads."""
    page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded", timeout=30000)
    page.wait_for_selector('input[type="email"]', timeout=10000)
    page.fill('input[type="email"]', email)
    page.fill('input[type="password"]', password)
    page.click('button[type="submit"]')
    # Wait for URL to change to /dashboard (not /login)
    try:
        page.wait_for_url(lambda url: "/dashboard" in url and "/login" not in url, timeout=20000)
    except PWTimeoutError:
        current = page.url
        print(f"    WARN: Login wait timed out, URL: {current}")
    page.wait_for_load_state("networkidle", timeout=15000)
    # Verify we're actually logged in
    current = page.url
    if "/login" in current:
        raise RuntimeError(f"Login failed for {email} - still at {current}")
    print(f"    Logged in as {email.split('@')[0]}")


def clear_session(page):
    """Clear storage to force fresh login."""
    try:
        if "medcore.globusdemos.com" not in (page.url or ""):
            page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded", timeout=15000)
        page.evaluate(
            "() => { try { localStorage.clear(); sessionStorage.clear(); } catch(e){} }"
        )
    except Exception:
        pass


def capture(page, name, path):
    url = f"{BASE_URL}{path}"
    try:
        page.goto(url, wait_until="networkidle", timeout=45000)
        # Verify we didn't get redirected to login
        if "/login" in page.url and path != "/login":
            print(f"  [REDIRECT] {name}: landed on login page, session lost")
            return False
        time.sleep(2.5)  # Let any lazy-loaded components settle
        page.keyboard.press("Escape")
        time.sleep(0.3)
        out = OUTPUT_DIR / f"{name}.png"
        page.screenshot(path=str(out), full_page=True)
        print(f"  [OK] {name}")
        return True
    except Exception as e:
        print(f"  [FAIL] {name}: {e}")
        return False


def run_role_batch(browser, role, pages):
    if role is None:
        # Public pages — fresh context each time to avoid token carryover
        for name, path in pages:
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            page = context.new_page()
            page.on("pageerror", lambda e: None)
            print(f"  [public] {name} ({path})")
            capture(page, name, path)
            context.close()
        return 0, len(pages)

    email, password = CREDS[role]
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    page.on("pageerror", lambda e: None)

    print(f"\n=== {role.upper()} — {len(pages)} pages ===")
    try:
        login(page, email, password)
    except Exception as e:
        print(f"  ERROR: Could not login as {role}: {e}")
        context.close()
        return 0, 0

    done = 0
    failed = 0
    for name, path in pages:
        if capture(page, name, path):
            done += 1
        else:
            failed += 1
    context.close()
    return done, failed


def main():
    print(f"Saving screenshots to: {OUTPUT_DIR}")
    total_pages = (
        len(PUBLIC_PAGES) + len(ADMIN_PAGES) + len(DOCTOR_PAGES) + len(NURSE_PAGES)
    )
    print(f"Total pages: {total_pages}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        all_done = 0
        all_failed = 0

        print("\n=== PUBLIC PAGES ===")
        for name, path in PUBLIC_PAGES:
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            page = context.new_page()
            page.on("pageerror", lambda e: None)
            print(f"  [public] {name} ({path})")
            if capture(page, name, path):
                all_done += 1
            else:
                all_failed += 1
            context.close()

        d, f = run_role_batch(browser, "admin", ADMIN_PAGES)
        all_done += d
        all_failed += f

        d, f = run_role_batch(browser, "doctor", DOCTOR_PAGES)
        all_done += d
        all_failed += f

        d, f = run_role_batch(browser, "nurse", NURSE_PAGES)
        all_done += d
        all_failed += f

        browser.close()

    print(f"\nTotal: {all_done} OK, {all_failed} failed")


if __name__ == "__main__":
    main()
