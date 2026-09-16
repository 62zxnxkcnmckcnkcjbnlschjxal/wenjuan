// D1 数据访问 + 首次访问自动建表
let initPromise = null;

export async function ensureDb(env) {
  if (!env || !env.DB) {
    throw new Error('D1 数据库未绑定，请检查 wrangler.toml 的 [[d1_databases]] 配置');
  }
  if (!initPromise) {
    initPromise = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS surveys (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '未命名问卷',
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        end_at INTEGER NOT NULL DEFAULT 0,
        settings TEXT NOT NULL DEFAULT '{}',
        structure TEXT NOT NULL DEFAULT '[]'
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS responses (
        id TEXT PRIMARY KEY,
        survey_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_responses_survey ON responses(survey_id, created_at)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`)
    ]).then(() => true).catch((e) => {
      initPromise = null;
      throw e;
    });
  }
  await initPromise;
  return env.DB;
}

// ---- 问卷 ----
export async function listSurveys(env) {
  const db = await ensureDb(env);
  const { results } = await db.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) AS response_count
     FROM surveys s ORDER BY s.updated_at DESC`
  ).all();
  return results.map(row => {
    const survey = parseSurvey(row);
    survey.responseCount = Number(row.response_count || 0);
    return survey;
  });
}

export async function getSurvey(env, id) {
  const db = await ensureDb(env);
  const row = await db.prepare('SELECT * FROM surveys WHERE id = ?').bind(id).first();
  return row ? parseSurvey(row) : null;
}

export async function createSurvey(env, data) {
  const db = await ensureDb(env);
  const now = Date.now();
  const id = data.id || genSurveyId();
  await db.prepare(
    `INSERT INTO surveys (id, title, description, status, created_at, updated_at, end_at, settings, structure)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    String(data.title || '未命名问卷').slice(0, 200),
    String(data.description || '').slice(0, 2000),
    data.status === 'published' ? 'published' : 'draft',
    now, now,
    Number(data.end_at || 0),
    JSON.stringify(data.settings || {}),
    JSON.stringify(Array.isArray(data.structure) ? data.structure : [])
  ).run();
  return getSurvey(env, id);
}

export async function updateSurvey(env, id, data) {
  const db = await ensureDb(env);
  const exist = await db.prepare('SELECT * FROM surveys WHERE id = ?').bind(id).first();
  if (!exist) return null;
  await db.prepare(
    `UPDATE surveys SET title = ?, description = ?, status = ?, end_at = ?, settings = ?, structure = ?, updated_at = ? WHERE id = ?`
  ).bind(
    String(data.title != null ? data.title : exist.title).slice(0, 200),
    String(data.description != null ? data.description : '').slice(0, 2000),
    ['draft', 'published', 'closed'].includes(data.status) ? data.status : 'draft',
    Number(data.end_at || 0),
    JSON.stringify(data.settings || {}),
    JSON.stringify(Array.isArray(data.structure) ? data.structure : []),
    Date.now(), id
  ).run();
  return getSurvey(env, id);
}

export async function deleteSurvey(env, id) {
  const db = await ensureDb(env);
  await db.batch([
    db.prepare('DELETE FROM responses WHERE survey_id = ?').bind(id),
    db.prepare('DELETE FROM surveys WHERE id = ?').bind(id)
  ]);
  return true;
}

export async function duplicateSurvey(env, id) {
  const src = await getSurvey(env, id);
  if (!src) return null;
  const now = Date.now();
  const copy = {
    title: src.title + '（副本）',
    description: src.description,
    status: 'draft',
    end_at: 0,
    settings: src.settings,
    structure: src.structure
  };
  const db = await ensureDb(env);
  const newId = genSurveyId();
  await db.prepare(
    `INSERT INTO surveys (id, title, description, status, created_at, updated_at, end_at, settings, structure)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(newId, copy.title, copy.description, copy.status, now, now, 0, JSON.stringify(copy.settings), JSON.stringify(copy.structure)).run();
  return getSurvey(env, newId);
}

// ---- 答卷 ----
export async function countResponses(env, surveyId) {
  const db = await ensureDb(env);
  const row = await db.prepare('SELECT COUNT(*) AS c FROM responses WHERE survey_id = ?').bind(surveyId).first();
  return Number(row ? row.c : 0);
}

export async function addResponse(env, surveyId, data) {
  const db = await ensureDb(env);
  const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await db.prepare('INSERT INTO responses (id, survey_id, data, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, surveyId, JSON.stringify(data), Date.now()).run();
  return id;
}

export async function listResponses(env, surveyId, limit = 500) {
  const db = await ensureDb(env);
  const { results } = await db.prepare(
    'SELECT id, data, created_at FROM responses WHERE survey_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(surveyId, limit).all();
  return results.map(r => ({
    id: r.id,
    createdAt: Number(r.created_at),
    data: safeObj(r.data)
  }));
}

export async function deleteResponse(env, id) {
  const db = await ensureDb(env);
  await db.prepare('DELETE FROM responses WHERE id = ?').bind(id).run();
  return true;
}

// ---- 内部 ----
function parseSurvey(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    endAt: Number(row.end_at || 0),
    settings: safeObj(row.settings),
    structure: Array.isArray(safeObj(row.structure)) ? safeObj(row.structure) : []
  };
}

function safeObj(s) {
  if (typeof s === 'string') {
    try { return JSON.parse(s); } catch (e) { return {}; }
  }
  return s || {};
}

function genSurveyId() {
  const rand = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (let i = 0; i < rand.length; i++) s += rand[i].toString(36).padStart(2, '0');
  const ts = Date.now().toString(36);
  return ts.slice(-4) + s.slice(0, 6);
}
