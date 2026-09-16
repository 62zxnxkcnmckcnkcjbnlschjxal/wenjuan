# 问卷工作台（Survey Workbench）

一个可直接部署到 **Cloudflare Pages** 的轻量问卷平台，功能对标问卷星的常用能力：

- 📝 **创建与管理问卷**：单选 / 多选 / 填空 / 评分 / 下拉 / 日期六种题型，必答控制、"其他"选项、拖拽排序、实时预览、发布 / 结束 / 复制 / 删除
- 🔗 **公开填答页**：`/s/<问卷ID>` 一键分享，无需登录即可填写，自动校验必答题
- 📊 **回收与统计**：答卷明细表、每题分布条形图、评分平均分、文本答案汇总
- 📥 **导出 CSV**：带表头的 Excel 可直接打开的答卷数据
- ✨ **DeepSeek AI 能力**（密钥存于 CF 加密密文）：
  - **一键生成问卷**：输入主题（如"我想收集一个《光遇》游戏玩法的问卷"），系统先联网检索相关资料注入上下文，再让 DeepSeek 自动设计整份问卷，预览后可保存为草稿或直接发布
  - **AI 数据分析**：对已回收答卷自动输出总体概述、核心发现、风险信号、可执行建议

---

## 项目结构

```
survey-platform/
├── wrangler.toml            # CF Pages + D1 配置（database_id 需替换）
├── schema.sql               # D1 建表 SQL（可选，应用会自动建表）
├── package.json             # 脚本：dev / deploy / secret / check
├── README.md
├── functions/               # Cloudflare Pages Functions（后端 API）
│   ├── _middleware.js       # 全站中间件：管理接口鉴权、公开填答放行
│   ├── _lib/                # 共享库：D1 / 鉴权 / DeepSeek / 联网搜索 / 统计
│   └── api/
│       ├── auth/            # 登录 / 登出 / 状态
│       ├── surveys/         # 问卷 CRUD、发布/复制、公开填答、答卷、导出、统计
│       └── ai/              # DeepSeek 密钥状态 / 一键生成 / 数据分析
└── public/                  # 前端静态资源（Pages 构建输出目录）
    ├── index.html           # 管理后台 SPA
    ├── fill.html            # 公开填答页
    ├── app.js / fill.js / renderer.js / style.css
    ├── manifest.json、icons/、_redirects
```

> 部署方式与参考项目一致：**Cloudflare Pages + Functions + 加密密文（Secrets）**。
> 存储使用 **D1（SQLite）** 持久化问卷与答卷，密钥（DeepSeek API Key、后台密码）均放在 CF 加密密文中，**不写入代码仓库**。

---

## 部署步骤（约 5 分钟）

### 0. 准备

- 一个 Cloudflare 账号
- 一个 DeepSeek API Key（https://platform.deepseek.com 申请，`sk-` 开头）
- 本机安装 Node.js ≥ 18

### 1. 登录与安装依赖

```bash
cd survey-platform
npm install          # 安装 wrangler
npx wrangler login   # 浏览器授权 Cloudflare
```

### 2. 创建 D1 数据库

```bash
npx wrangler d1 create survey-workbench
```

把输出里的 `database_id` 填到 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "survey-workbench"
database_id = "你的-database-id"   # ← 替换这里
```

初始化表结构（**可跳过**，应用首次访问会自动建表；手动执行更稳妥）：

```bash
npm run db:init
```

### 3. 设置加密密文（CF Secrets）

```bash
# DeepSeek API 密钥（AI 生成 / 分析必填）
npx wrangler pages secret put DEEPSEEK_API_KEY
# 管理后台访问密码（强烈建议生产环境设置；不设置则后台完全开放）
npx wrangler pages secret put ADMIN_PASSWORD
```

### 4. 部署

```bash
npm run deploy      # 等价于 npx wrangler pages deploy
```

部署完成后会输出站点域名（如 `https://survey-workbench.pages.dev`）。如需自定义域名，在 Cloudflare 控制台 Pages 项目的「自定义域」里绑定即可。

---

## 使用说明

| 功能 | 入口 |
|---|---|
| 新建问卷 | 后台首页 →「＋ 新建问卷」 |
| AI 一键生成 | 后台首页 →「✨ AI 一键生成」，输入主题 → 生成 → 保存/发布 |
| 编辑题目 | 点问卷「编辑」：加题、改选项、拖拽排序、右侧实时预览 |
| 发布与分享 | 编辑页右上「发布」，再点「🔗 填答链接」复制 `/s/<ID>` 链接 |
| 查看结果 | 后台「结果」：分布统计 + 明细表 + 导出 CSV + AI 分析 |
| 结束问卷 | 编辑页「结束问卷」或列表「结束」 |

填答页访问路径：`https://你的域名/s/问卷ID`

---

## 本地预览（可选，无需 CF 账号）

```bash
npm run dev
```

启动本地模拟服务器（内置内存版后端 + DeepSeek 模拟），浏览器打开 `http://localhost:8787` 即可体验完整流程。
真实部署后 AI 功能以 `DEEPSEEK_API_KEY` 为准。

可选端到端测试（需本机 Chromium + Python playwright）：

```bash
python3 e2e-test.py   # 覆盖后台/编辑器/AI生成/填答/结果/导出全流程
```

---

## 安全说明

- **DeepSeek 密钥**：只存在于 Cloudflare 加密密文，前端永远拿不到；API 通过服务端代理调用，无 CORS/泄露风险
- **后台鉴权**：设置 `ADMIN_PASSWORD` 后，所有管理 API 需 HMAC 签名 Cookie（30 天有效）才可访问；填答接口保持公开
- **答题校验**：必答题、选项合法性在服务端二次校验
- **联网检索为"尽力而为"**：DeepSeek 官方 API 不带联网，本项目通过服务端抓取公开网页摘要注入上下文实现"先搜后答"；若公开检索端点不可用，会自动降级为基于 AI 知识生成（界面会有提示）

## 常见问题

- **AI 提示"未配置密钥"** → 执行 `npx wrangler pages secret put DEEPSEEK_API_KEY` 后重新部署
- **修改密钥** → 重新执行 `secret put` 覆盖即可
- **D1 绑定报错** → 确认 `wrangler.toml` 中 `database_id` 已替换为真实 ID
- **想清空数据** → 后台删除问卷即连答卷一起删除
