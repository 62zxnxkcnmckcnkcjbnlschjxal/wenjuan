#!/usr/bin/env python3
"""Quick manual test for the share link bug"""
from playwright.sync_api import sync_playwright
import urllib.request, json

BASE = "http://localhost:8787"

def api(path, method="GET", body=None):
    req = urllib.request.Request(BASE + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/chromium-browser", args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1400, "height": 1000})
    page.on("console", lambda m: print(f"[console {m.type}] {m.text}"))
    page.on("pageerror", lambda e: print(f"[pageerror] {e}"))

    # 1. Create and publish survey via API
    survey = api("/api/surveys", "POST", {
        "title": "Bug测试问卷",
        "description": "测试分享链接",
        "structure": [
            {"id": "q1", "type": "radio", "title": "问题1", "required": True, "options": ["A", "B"]}
        ],
        "settings": {"submitTip": "谢谢"}
    })["survey"]
    sid = survey["id"]
    api(f"/api/surveys/{sid}/actions", "POST", {"action": "publish"})
    print(f"Created and published survey: {sid}")

    # 2. Open editor and check the fill link button
    page.goto(BASE + f"/#/edit/{sid}", wait_until="networkidle")
    page.wait_for_timeout(500)
    btn = page.locator('button:has-text("填答链接")')
    print(f"Fill link button visible: {btn.is_visible()}")
    if btn.is_visible():
        # Get the href/open behavior
        link_text = page.evaluate("""
            (() => {
                const s = window.App ? window.App.copyFillLink : null;
                if (!s) return 'App.copyFillLink not found';
                return 'found';
            })()
        """)
        print(f"App.copyFillLink: {link_text}")

    # 3. Open fill page directly
    page.goto(BASE + f"/s/{sid}", wait_until="networkidle")
    page.wait_for_timeout(500)
    title = page.locator(".fill-head h2").inner_text()
    print(f"Fill page title: {title}")

    # 4. Check if there's a "copy link" in dashboard row actions
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(500)
    actions = page.locator(".survey-row .s-actions").first.inner_text()
    print(f"Row actions: {actions}")

    browser.close()
    print("Done")
