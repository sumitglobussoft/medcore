"""
Retry capture of pages that failed. Uses longer delays to avoid rate limits.
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

# Pages that need retry (admin session dropped or nurse failed)
ADMIN_RETRY = [
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

DOCTOR_RETRY = [
    ("08-workspace-doctor", "/dashboard/workspace"),
]

NURSE_RETRY = [
    ("05-dashboard-nurse", "/dashboard"),
    ("09-workstation-nurse", "/dashboard/workstation"),
    ("16-vitals", "/dashboard/vitals"),
    ("21-medication-dashboard", "/dashboard/medication-dashboard"),
]


def login_via_api_and_inject(page, email, password):
    """
    Login via fetch and inject tokens into localStorage. This avoids hitting
    the UI login multiple times (stays under the 10/min auth rate limit).
    """
    # Navigate to the domain first so localStorage is accessible
    page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded", timeout=30000)
    # Call the API directly via page's fetch
    result = page.evaluate(
        """
        async ({email, password}) => {
          const res = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({email, password})
          });
          const data = await res.json();
          return data;
        }
        """,
        {"email": email, "password": password},
    )
    if not result.get("success"):
        raise RuntimeError(f"Login API failed: {result}")
    tokens = result["data"]["tokens"]
    # Inject tokens into localStorage
    page.evaluate(
        """
        (tokens) => {
          localStorage.setItem('medcore_token', tokens.accessToken);
          localStorage.setItem('medcore_refresh', tokens.refreshToken);
        }
        """,
        tokens,
    )
    # Go to dashboard to let the app re-hydrate
    page.goto(f"{BASE_URL}/dashboard", wait_until="networkidle", timeout=20000)
    print(f"    Logged in as {email.split('@')[0]}")


def capture(page, name, path, delay=4):
    url = f"{BASE_URL}{path}"
    try:
        page.goto(url, wait_until="networkidle", timeout=60000)
        if "/login" in page.url and path != "/login":
            print(f"  [REDIRECT] {name}: session lost")
            return False
        time.sleep(delay)
        page.keyboard.press("Escape")
        time.sleep(0.3)
        out = OUTPUT_DIR / f"{name}.png"
        page.screenshot(path=str(out), full_page=True)
        print(f"  [OK] {name}")
        return True
    except Exception as e:
        print(f"  [FAIL] {name}: {str(e)[:100]}")
        return False


def run_role(browser, role, pages, page_delay=4):
    if not pages:
        return 0, 0
    email, password = CREDS[role]
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    page.on("pageerror", lambda e: None)

    print(f"\n=== {role.upper()} — {len(pages)} pages ===")
    try:
        login_via_api_and_inject(page, email, password)
    except Exception as e:
        print(f"  ERROR: Could not login as {role}: {e}")
        context.close()
        return 0, len(pages)

    done = 0
    failed = 0
    for name, path in pages:
        if capture(page, name, path, delay=page_delay):
            done += 1
        else:
            failed += 1
        # Small inter-page delay to stay under 100 req/min
        time.sleep(1)

    context.close()
    return done, failed


def main():
    print("Retry screenshot capture with API-based login")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        admin_done, admin_failed = run_role(browser, "admin", ADMIN_RETRY, page_delay=3)
        # Wait to reset rate limit window before next role
        print("\n[Waiting 65s to reset rate limit window...]")
        time.sleep(65)

        doctor_done, doctor_failed = run_role(browser, "doctor", DOCTOR_RETRY, page_delay=3)
        print("\n[Waiting 65s...]")
        time.sleep(65)

        nurse_done, nurse_failed = run_role(browser, "nurse", NURSE_RETRY, page_delay=3)

        browser.close()

    total_done = admin_done + doctor_done + nurse_done
    total_failed = admin_failed + doctor_failed + nurse_failed
    print(f"\n=== Retry totals: {total_done} OK, {total_failed} failed ===")


if __name__ == "__main__":
    main()
