// 轻量联网搜索（尽力而为）：在调用 DeepSeek 前抓取公开网页摘要注入上下文，
// 让 AI 基于最新/真实的外部信息生成问卷。DeepSeek 官方 API 本身不带联网，
// 此模块通过公共搜索端点实现“先搜后答”；任一来源失败时静默降级为空结果。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function clean(s) {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// 来源 1：DuckDuckGo HTML 版
async function searchDuckDuckGo(query, limit) {
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return [];
  const html = await res.text();
  const out = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const links = [...html.matchAll(linkRe)];
  const snips = [...html.matchAll(snipRe)];
  for (let i = 0; i < links.length && out.length < limit; i++) {
    const title = clean(links[i][2]);
    if (!title) continue;
    let url2 = links[i][1];
    const m = url2.match(/uddg=([^&]+)/);
    if (m) { try { url2 = decodeURIComponent(m[1]); } catch (e) {} }
    const snippet = snips[i] ? clean(snips[i][1]) : '';
    out.push({ title, url: url2, snippet });
  }
  return out;
}

// 来源 2：Bing 网页版
async function searchBing(query, limit) {
  const url = 'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=zh-hans';
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return [];
  const html = await res.text();
  const out = [];
  const re = /<li class="b_algo"[\s\S]*?<h2><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>([\s\S]*?)(?=<li class="b_algo"|<\/ol>)/g;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    const title = clean(m[2]);
    if (!title) continue;
    const snipMatch = m[3].match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = snipMatch ? clean(snipMatch[1]) : '';
    out.push({ title, url: m[1], snippet });
  }
  return out;
}

// 统一入口：返回 [{title, url, snippet}]，最多 limit 条
export async function searchWeb(query, limit = 6) {
  const sources = [searchDuckDuckGo, searchBing];
  for (const fn of sources) {
    try {
      const r = await fn(query, limit);
      if (r && r.length > 0) return r;
    } catch (e) { /* 尝试下一个来源 */ }
  }
  return [];
}
