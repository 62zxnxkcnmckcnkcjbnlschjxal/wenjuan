-- ============================================================
-- 问卷工作台 · D1 数据库结构
-- 应用首次访问 API 时会自动执行等价建表（CREATE TABLE IF NOT EXISTS），
-- 此文件用于手动初始化 / 迁移参考。
-- 执行：wrangler d1 execute survey-workbench --remote --file=schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS surveys (
  id          TEXT PRIMARY KEY,             -- 问卷短 ID（如 a1b2c3d4）
  title       TEXT NOT NULL DEFAULT '未命名问卷',
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',-- draft 草稿 | published 发布中 | closed 已结束
  created_at  INTEGER NOT NULL,             -- Unix 毫秒
  updated_at  INTEGER NOT NULL,
  end_at      INTEGER NOT NULL DEFAULT 0,   -- 截止时间（0 = 永不过期）
  settings    TEXT NOT NULL DEFAULT '{}',   -- JSON：{ submitTip, publicResult, ... }
  structure   TEXT NOT NULL DEFAULT '[]'    -- JSON：题目数组
);

CREATE TABLE IF NOT EXISTS responses (
  id         TEXT PRIMARY KEY,              -- 答卷 ID
  survey_id  TEXT NOT NULL,
  data       TEXT NOT NULL,                 -- JSON：{ qid: answer }
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_responses_survey ON responses(survey_id, created_at);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);
