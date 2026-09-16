// 问卷统计计算：输入题目结构与答卷列表，输出每题统计
export function computeStats(structure, responses) {
  const total = responses.length;
  const perQuestion = [];

  for (const q of structure) {
    const stat = {
      id: q.id,
      title: q.title,
      type: q.type,
      required: !!q.required,
      answered: 0,
      skipped: 0
    };

    if (q.type === 'radio' || q.type === 'dropdown' || q.type === 'checkbox') {
      const counts = {};
      let otherCount = 0;
      const otherTexts = [];
      (q.options || []).forEach(o => { counts[o] = 0; });
      if (q.allowOther) counts['__other__'] = 0;

      for (const r of responses) {
        const v = r.data[q.id];
        if (v === undefined || v === null || v === '') { stat.skipped++; continue; }
        stat.answered++;
        if (q.type === 'checkbox') {
          const arr = Array.isArray(v) ? v : [v];
          for (const item of arr) {
            if (q.allowOther && typeof item === 'string' && item.startsWith('__other__:')) {
              otherCount++;
              otherTexts.push(item.slice('__other__:'.length));
              counts['__other__'] = (counts['__other__'] || 0) + 1;
            } else {
              counts[item] = (counts[item] || 0) + 1;
            }
          }
        } else {
          if (q.allowOther && typeof v === 'string' && v.startsWith('__other__:')) {
            otherCount++;
            otherTexts.push(v.slice('__other__:'.length));
            counts['__other__'] = (counts['__other__'] || 0) + 1;
          } else {
            counts[v] = (counts[v] || 0) + 1;
          }
        }
      }
      stat.counts = counts;
      stat.otherTexts = otherTexts;
    } else if (q.type === 'rating') {
      const buckets = {};
      const max = q.maxRating || 5;
      for (let i = 1; i <= max; i++) buckets[i] = 0;
      let sum = 0, n = 0;
      for (const r of responses) {
        const v = r.data[q.id];
        if (v === undefined || v === null || v === '') { stat.skipped++; continue; }
        stat.answered++;
        const num = Number(v);
        buckets[num] = (buckets[num] || 0) + 1;
        sum += num; n++;
      }
      stat.buckets = buckets;
      stat.average = n ? Math.round((sum / n) * 100) / 100 : 0;
    } else if (q.type === 'date') {
      const counts = {};
      for (const r of responses) {
        const v = r.data[q.id];
        if (!v) { stat.skipped++; continue; }
        stat.answered++;
        const key = String(v).slice(0, 7); // 按月聚合
        counts[key] = (counts[key] || 0) + 1;
      }
      stat.counts = counts;
    } else {
      // text / 其他开放题
      const texts = [];
      for (const r of responses) {
        const v = r.data[q.id];
        if (v === undefined || v === null || v === '') { stat.skipped++; continue; }
        stat.answered++;
        texts.push(String(v));
      }
      stat.texts = texts;
    }
    perQuestion.push(stat);
  }
  return { total, perQuestion };
}
