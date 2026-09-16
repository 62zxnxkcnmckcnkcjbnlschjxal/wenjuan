/* ============================================================
   兜底路由：/s/<问卷ID> 由 Function 直接返回填答页
   ------------------------------------------------------------
   为什么需要它：
   部分部署环境下（面板重定向规则或 _redirects 配置不当），
   /s/* 会被 308 重定向到 /fill，导致问卷 ID 在跳转后丢失，
   填答页提示"链接无效"。

   Cloudflare Pages 的请求处理优先级为：
   Functions  >  _redirects  >  静态资源
   因此本路由可确保 /s/<问卷ID> 始终以 200 返回填答页且 URL 不变，
   填答页脚本能正常解析出问卷 ID。

   页面内容与 public/fill.html 保持一致（如修改 fill.html 请同步此处）。
   ============================================================ */
const FILL_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" id="metaTheme" content="#f1f7f5">
<link rel="icon" type="image/png" href="/icons/icon-192.png">
<title>问卷填答</title>
<link rel="stylesheet" href="/style.css">
<script>
(function(){try{
  var d=(localStorage.getItem('qwDark')==='1')||(localStorage.getItem('qwDark')===null&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  if(d)document.documentElement.classList.add('dark');
  var t=document.querySelector('meta[name=theme-color]');
  if(t)t.setAttribute('content',d?'#0d1412':'#f1f7f5');
}catch(e){}})();
</script>
</head>
<body>
<div class="app">
  <main class="container" style="max-width:720px">
    <div id="fillRoot"></div>
  </main>
</div>
<div id="toast-wrap"></div>
<script src="/renderer.js"></script>
<script src="/fill.js"></script>
</body>
</html>`;

export async function onRequestGet() {
  return new Response(FILL_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
