// GET /api/surveys/:id/export —— 导出答卷 CSV（含 BOM，Excel 可直接打开）
import { error } from '../../../_lib/util.js';
import { getSurvey, listResponses } from '../../../_lib/db.js';

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export async function onRequestGet(ctx) {
  try {
    const id = ctx.params && ctx.params.id;
    const survey = await getSurvey(ctx.env, id);
    if (!survey) return error('问卷不存在', 404);

    const responses = await listResponses(ctx.env, id, 2000);
    const header = ['提交时间'].concat(survey.structure.map((q, i) => 'Q' + (i + 1) + '.' + q.title));
    const rows = responses.map(r => {
      const cells = [new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })];
      for (const q of survey.structure) {
        const v = r.data[q.id];
        if (v === undefined || v === null) cells.push('');
        else if (Array.isArray(v)) cells.push(v.map(x => String(x).replace(/^__other__:/, '[其他] ')).join(' | '));
        else cells.push(String(v).replace(/^__other__:/, '[其他] '));
      }
      return cells;
    });
    const csv = '\uFEFF' + [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');

    const fname = 'survey_' + id + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + fname + '"',
        'Cache-Control': 'no-store'
      }
    });
  } catch (e) {
    return error('导出失败：' + e.message, 500);
  }
}
