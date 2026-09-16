#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""问卷工作台端到端冒烟测试（自包含：先通过 API 建数据，再走 UI 全流程）"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8787"
results = []
errors = []

def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + ("  " + detail if detail else ""))

def api(path, method="GET", body=None):
    import urllib.request, json
    req = urllib.request.Request(BASE + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

def main():
    # ---------- 准备数据（直接走 API，模拟“管理员已创建好问卷”） ----------
    survey = api("/api/surveys", "POST", {
        "title": "光遇玩法调查",
        "description": "测试问卷",
        "structure": [
            {"id": "q1", "type": "radio", "title": "你玩光遇多久了？", "required": True, "options": ["1个月", "半年", "1年以上"]},
            {"id": "q2", "type": "checkbox", "title": "喜欢哪些玩法？", "required": True, "options": ["跑图", "社交", "装扮"], "allowOther": True},
            {"id": "q3", "type": "rating", "title": "满意度", "required": True, "maxRating": 5},
            {"id": "q4", "type": "text", "title": "建议", "required": False, "placeholder": "写点什么"}
        ],
        "settings": {"submitTip": "感谢参与"}
    })["survey"]
    sid = survey["id"]
    api(f"/api/surveys/{sid}/actions", "POST", {"action": "publish"})

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/chromium-browser", args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

        # ---------- 1. 管理后台仪表盘 ----------
        page.goto(BASE + "/", wait_until="networkidle")
        check("后台首页标题", "问卷工作台" in page.title())
        check("统计卡片渲染", page.locator(".stat-card").count() >= 4)
        check("问卷列表有数据", page.locator(".survey-row").count() >= 1)

        # ---------- 2. 编辑器 ----------
        page.goto(BASE + f"/#/edit/{sid}", wait_until="networkidle")
        page.wait_for_selector(".q-card", timeout=8000)
        check("编辑器题目卡", page.locator(".q-card").count() == 4)
        check("编辑器预览区", page.locator("#editorPreview .fq").count() == 4)

        first_title = page.locator(".q-title-input").first
        first_title.fill("你玩光遇多久了？（改）")
        page.wait_for_timeout(1500)
        check("自动保存后标题更新", "（改）" in (first_title.input_value() or ""))

        page.locator('button:has-text("＋ 下拉")').click()
        page.wait_for_timeout(300)
        check("新增下拉题", page.locator(".q-card").count() == 5)
        page.locator(".q-card .q-tools [data-act=del]").last.click()
        page.wait_for_timeout(300)
        check("删除题目", page.locator(".q-card").count() == 4)

        # ---------- 3. AI 生成页 ----------
        page.goto(BASE + "/#/ai", wait_until="networkidle")
        page.wait_for_selector("#aiTopic", timeout=5000)
        page.wait_for_function("document.querySelector('#aiBanner').innerText.includes('DeepSeek')", timeout=8000)
        check("AI 状态徽章", "DeepSeek" in page.locator("#aiBanner").inner_text())
        page.fill("#aiTopic", "我想收集一个光遇游戏产品玩法的问卷")
        page.click("#aiGenBtn")
        page.wait_for_selector("#genSaveBtn", timeout=30000)
        check("AI 生成预览出现", "光遇" in page.locator("#aiResult").inner_text())
        check("AI 生成题目数", page.locator(".gp-q").count() >= 5)

        # 保存并直接发布 → 得到可填答的 AI 问卷
        page.click("#genPublishBtn")
        page.wait_for_url("**/#/edit/**", timeout=10000)
        page.wait_for_selector(".q-card", timeout=8000)
        ai_id = page.url.rsplit("/", 1)[-1]
        check("AI 问卷已创建并进入编辑器", len(ai_id) >= 6)

        # ---------- 4. 公开填答页（用 AI 问卷，题目更多） ----------
        page.goto(BASE + f"/s/{ai_id}", wait_until="networkidle")
        page.wait_for_selector(".fq", timeout=8000)
        check("填答页标题", "光遇" in page.locator(".fill-head h2").inner_text())
        check("填答页题目数", page.locator(".fq").count() >= 5)

        page.locator("#submitBtn").click()
        page.wait_for_timeout(400)
        check("必答校验拦截", page.locator(".fq.invalid").count() >= 1)

        # 作答全部必答（每类题型至少选一项）
        fq = page.locator(".fq")
        for i in range(fq.count()):
            box = fq.nth(i)
            radio = box.locator('input[type=radio]')
            cb = box.locator('input[type=checkbox]')
            star = box.locator(".star-btn")
            if radio.count() > 0 and not radio.first.is_checked():
                radio.nth(0).check(force=True)
            elif cb.count() > 0:
                cb.nth(0).check(force=True)
            elif star.count() > 0:
                star.nth(3).click()
            elif box.locator("select.fq-select").count() > 0:
                box.locator("select.fq-select").select_option(index=1)
            elif box.locator("textarea").count() > 0:
                box.locator("textarea").fill("希望多出季节活动")
            elif box.locator('input[type=date]').count() > 0:
                box.locator('input[type=date]').fill("2026-09-01")
        page.wait_for_timeout(200)
        page.locator("#submitBtn").click()
        page.wait_for_selector("text=提交成功", timeout=8000)
        check("填答提交成功", "提交成功" in page.locator("#fillRoot").inner_text())

        # ---------- 5. 结果页（统计 + AI 分析 + 导出） ----------
        page.goto(BASE + f"/#/results/{ai_id}", wait_until="networkidle")
        page.wait_for_selector(".stat-block", timeout=8000)
        check("结果页统计块", page.locator(".stat-block").count() >= 2)
        check("结果页含答卷数", "答卷" in page.locator("#resultsBody").inner_text())
        page.click('[data-act=analyze]')
        page.wait_for_selector(".ai-section", timeout=30000)
        check("AI 分析渲染", page.locator(".ai-section").count() >= 4)
        check("AI 分析含核心发现", "核心发现" in page.locator("#resultsBody").inner_text())

        with page.expect_download() as dl:
            page.click('[data-act=export]')
        dl = dl.value
        check("导出 CSV 文件名", dl.suggested_filename.endswith(".csv"))

        # ---------- 6. 控制台错误 ----------
        real_errors = [e for e in errors if "favicon" not in e.lower()]
        check("无控制台错误", len(real_errors) == 0, "; ".join(real_errors[:5]))

        browser.close()

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n===== 共 {len(results)} 项，通过 {passed} 项 =====")
    if passed != len(results):
        for n, ok, d in results:
            if not ok:
                print("FAILED:", n, d)
        sys.exit(1)

if __name__ == "__main__":
    main()
