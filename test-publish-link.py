#!/usr/bin/env python3
"""Test the publish-and-copy-link flow to find the exact bug"""
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

    toasts = []
    def on_console(msg):
        if msg.type == "error":
            print(f"[console error] {msg.text}")
        # Capture toast messages by monkey-patching
    page.on("console", on_console)

    # Create survey via API
    survey = api("/api/surveys", "POST", {
        "title": "发布测试",
        "description": "",
        "structure": [{"id": "q1", "type": "radio", "title": "Q1", "required": True, "options": ["A", "B"]}],
        "settings": {"submitTip": "谢谢"}
    })["survey"]
    sid = survey["id"]
    print(f"Created survey: {sid}, status={survey['status']}")

    # Open editor
    page.goto(BASE + f"/#/edit/{sid}", wait_until="networkidle")
    page.wait_for_timeout(500)

    # Check status chip text
    status_text = page.locator("#editorStatus").inner_text()
    print(f"Editor status: {status_text}")

    # Click 填答链接 BEFORE publishing
    btn = page.locator('button:has-text("填答链接")')
    btn.click()
    page.wait_for_timeout(500)
    toast = page.locator(".toast").last.inner_text() if page.locator(".toast").count() > 0 else "no toast"
    print(f"Copy link before publish: {toast}")

    # Click publish
    page.locator('button:has-text("发布")').click()
    page.wait_for_timeout(1500)

    # Check status chip after publish
    status_text = page.locator("#editorStatus").inner_text()
    print(f"Editor status after publish: {status_text}")

    # Click 填答链接 AFTER publishing
    btn = page.locator('button:has-text("填答链接")')
    btn.click()
    page.wait_for_timeout(500)
    toast = page.locator(".toast").last.inner_text() if page.locator(".toast").count() > 0 else "no toast"
    print(f"Copy link after publish: {toast}")

    # Check what buttons are visible
    buttons = page.locator("#editorHead button").all_inner_texts()
    print(f"Buttons after publish: {buttons}")

    # Get state.editing.status via JS
    status = page.evaluate("window.App && (() => { try { return JSON.parse(JSON.stringify({status: state.editing.status, id: state.editing.id})); } catch(e) { return {error: e.message}; } })()")
    print(f"JS state.editing: {status}")

    browser.close()
    print("Done")
