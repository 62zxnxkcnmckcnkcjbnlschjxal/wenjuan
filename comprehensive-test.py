#!/usr/bin/env python3
"""Comprehensive test for all fixes"""
from playwright.sync_api import sync_playwright
import urllib.request, json

BASE = "http://localhost:8787"

def api(path, method="GET", body=None):
    req = urllib.request.Request(BASE + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + ("  " + detail if detail else ""))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/chromium-browser", args=["--no-sandbox"])

    # === Test 1: Publish from editor, then copy link ===
    page = browser.new_page(viewport={"width": 1400, "height": 1000})
    survey = api("/api/surveys", "POST", {
        "title": "编辑器发布测试",
        "structure": [{"id": "q1", "type": "radio", "title": "Q1", "required": True, "options": ["A", "B"]}],
        "settings": {"submitTip": "谢谢"}
    })["survey"]
    sid = survey["id"]

    page.goto(BASE + f"/#/edit/{sid}", wait_until="networkidle")
    page.wait_for_timeout(500)
    page.locator('button:has-text("发布")').click()
    page.wait_for_timeout(1500)
    check("发布后状态显示发布中", "发布中" in page.locator("#editorStatus").inner_text())
    check("发布后按钮变为结束问卷", page.locator('button:has-text("结束问卷")').count() > 0)

    page.locator('button:has-text("填答链接")').click()
    page.wait_for_timeout(500)
    check("发布后复制链接成功", "填答链接已复制" in page.locator(".toast").last.inner_text())
    page.close()

    # === Test 2: Dashboard copy link button ===
    page = browser.new_page(viewport={"width": 1400, "height": 1000})
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(500)
    row = page.locator(".survey-row").first
    check("仪表盘有复制链接按钮", row.locator('button[data-act="copylink"]').count() > 0)
    row.locator('button[data-act="copylink"]').click()
    page.wait_for_timeout(500)
    check("仪表盘复制链接成功", "填答链接已复制" in page.locator(".toast").last.inner_text())
    page.close()

    # === Test 3: Close survey from editor ===
    page = browser.new_page(viewport={"width": 1400, "height": 1000})
    page.goto(BASE + f"/#/edit/{sid}", wait_until="networkidle")
    page.wait_for_timeout(500)
    page.locator('button:has-text("结束问卷")').click()
    page.wait_for_timeout(1500)
    check("结束后状态显示已结束", "已结束" in page.locator("#editorStatus").inner_text())
    page.close()

    # === Test 4: Fill page works for published survey ===
    survey2 = api("/api/surveys", "POST", {
        "title": "填答页测试",
        "structure": [
            {"id": "q1", "type": "radio", "title": "单选", "required": True, "options": ["A", "B"]},
            {"id": "q2", "type": "checkbox", "title": "多选", "required": True, "options": ["X", "Y"], "allowOther": True},
            {"id": "q3", "type": "rating", "title": "评分", "required": True, "maxRating": 5},
            {"id": "q4", "type": "text", "title": "建议", "required": False, "placeholder": "写点什么"}
        ],
        "settings": {"submitTip": "感谢参与"}
    })["survey"]
    sid2 = survey2["id"]
    api(f"/api/surveys/{sid2}/actions", "POST", {"action": "publish"})

    page = browser.new_page(viewport={"width": 1400, "height": 1000})
    page.goto(BASE + f"/s/{sid2}", wait_until="networkidle")
    page.wait_for_timeout(500)
    check("填答页加载成功", "填答页测试" in page.locator(".fill-head h2").inner_text())
    check("填答页题目数正确", page.locator(".fq").count() == 4)

    # Fill and submit
    page.locator(".fq").nth(0).locator('input[type=radio]').nth(0).check(force=True)
    page.locator(".fq").nth(1).locator('input[type=checkbox]').nth(0).check(force=True)
    page.locator(".fq").nth(2).locator(".star-btn").nth(3).click()
    page.locator(".fq").nth(3).locator("textarea").fill("测试建议")
    page.locator("#submitBtn").click()
    page.wait_for_selector("text=提交成功", timeout=8000)
    check("填答提交成功", "提交成功" in page.locator("#fillRoot").inner_text())
    page.close()

    # === Test 5: Results page ===
    page = browser.new_page(viewport={"width": 1400, "height": 1000})
    page.goto(BASE + f"/#/results/{sid2}", wait_until="networkidle")
    page.wait_for_timeout(500)
    check("结果页有统计块", page.locator(".stat-block").count() >= 2)
    page.close()

    # === Test 6: CSV export ===
    req = urllib.request.Request(f"{BASE}/api/surveys/{sid2}/export")
    with urllib.request.urlopen(req) as r:
        csv = r.read().decode()
    check("CSV导出含标题", "填答页测试" in csv or "单选" in csv)

    browser.close()

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n===== 共 {len(results)} 项，通过 {passed} 项 =====")
    if passed != len(results):
        for n, ok, d in results:
            if not ok:
                print("FAILED:", n, d)
        exit(1)
