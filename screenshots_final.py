"""Final retry for 2 timeout pages — use domcontentloaded instead of networkidle."""
import os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

os.environ["PYTHONIOENCODING"] = "utf-8"
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = "https://medcore.globusdemos.com"
OUT = Path(__file__).parent / "docs" / "screenshots"

JOBS = [
    ("doctor", "dr.sharma@medcore.local", "doctor123",
     [("08-workspace-doctor", "/dashboard/workspace")]),
    ("nurse", "nurse@medcore.local", "nurse123",
     [("09-workstation-nurse", "/dashboard/workstation")]),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for role, email, password, pages in JOBS:
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on("pageerror", lambda e: None)
        page.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=30000)
        res = page.evaluate(
            "async ({e,p}) => (await (await fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:p})})).json())",
            {"e": email, "p": password},
        )
        tokens = res["data"]["tokens"]
        page.evaluate(
            "(t) => { localStorage.setItem('medcore_token',t.accessToken); localStorage.setItem('medcore_refresh',t.refreshToken); }",
            tokens,
        )
        print(f"Logged in as {role}")
        for name, path in pages:
            try:
                page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=60000)
                if "/login" in page.url:
                    print(f"  [REDIRECT] {name}")
                    continue
                time.sleep(6)  # Let React render
                page.keyboard.press("Escape")
                time.sleep(0.3)
                page.screenshot(path=str(OUT / f"{name}.png"), full_page=True)
                print(f"  [OK] {name}")
            except Exception as e:
                print(f"  [FAIL] {name}: {str(e)[:80]}")
        ctx.close()
    browser.close()
print("Done")
