/**
 * 下载页模板：单文件、零外部依赖、离线可用，配色沿用 App 自己的 CSS 变量。
 * 只导出 buildPage()，给 tools/release-apk.mjs 用。
 */

export function buildPage(info) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>下载拾光日记</title>
<meta name="description" content="拾光日记最新安卓安装包下载：日记 · 记账 · 待办 · 排单" />
<meta name="theme-color" content="#f2f3f5" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#1b1c1f" media="(prefers-color-scheme: dark)" />
<style>
:root {
  color-scheme: light;
  --bg: #f2f3f5;
  --card: #ffffff;
  --surface-2: #e7e9ee;
  --text: #1b1d22;
  --text-dim: #61666f;
  --text-faint: #9aa0a9;
  --border: rgba(18, 20, 26, 0.07);
  --accent: #5a6296;
  --accent-soft: rgba(90, 98, 150, 0.12);
  --danger: #c0453f;
  --btn-bg: #26282f;
  --btn-fg: #ffffff;
  --shadow: 0 2px 10px rgba(18, 20, 26, 0.05);
  --radius: 22px;
  --radius-sm: 14px;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #1b1c1f;
    --card: #27292e;
    --surface-2: #32353b;
    --text: #e9eaee;
    --text-dim: #a5a9b1;
    --text-faint: #7e838c;
    --border: rgba(255, 255, 255, 0.06);
    --accent: #7b83c4;
    --accent-soft: rgba(123, 131, 196, 0.18);
    --danger: #e07a72;
    --btn-bg: #eceef1;
    --btn-fg: #1b1c1f;
    --shadow: 0 2px 12px rgba(0, 0, 0, 0.28);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 18px calc(32px + env(safe-area-inset-bottom, 0px));
}
.wrap { max-width: 460px; margin: 0 auto; }
.brand { text-align: center; margin: 10px 0 22px; }
.brand h1 { font-size: 26px; font-weight: 600; letter-spacing: 2px; margin: 0 0 6px; }
.brand p { margin: 0; color: var(--text-faint); font-size: 13px; letter-spacing: 1px; }
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px;
  margin-bottom: 14px;
}
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 17px 20px;
  border-radius: var(--radius-sm);
  background: var(--btn-bg);
  color: var(--btn-fg);
  font-size: 17px;
  font-weight: 600;
  text-decoration: none;
  transition: transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 260ms ease;
}
.btn:active { transform: scale(0.97); opacity: 0.88; }
.meta { margin: 14px 2px 0; color: var(--text-dim); font-size: 14px; }
.meta b { color: var(--text); font-weight: 600; }
.qr { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.qr svg { width: 196px; height: 196px; background: #fff; border-radius: var(--radius-sm); padding: 6px; }
.qr p { margin: 0; color: var(--text-faint); font-size: 13px; }
h2 { font-size: 15px; font-weight: 600; margin: 0 0 10px; }
.tips { margin: 0; padding-left: 20px; color: var(--text-dim); font-size: 14px; }
.tips li { margin: 7px 0; }
.tips strong { color: var(--danger); font-weight: 600; }
.tips b { color: var(--text); font-weight: 600; }
.links { text-align: center; font-size: 12px; color: var(--text-faint); line-height: 1.9; }
.links a { color: var(--accent); text-decoration: none; }
code {
  display: block;
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--surface-2);
  border-radius: 10px;
  font-size: 12px;
  color: var(--text-dim);
  word-break: break-all;
}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <h1>拾光日记</h1>
    <p>日记 · 记账 · 待办 · 排单</p>
  </div>

  <div class="card">
    <a class="btn" href="${info.apkUrl}">下载拾光日记 APK</a>
    <div class="meta">
      版本 <b>v${info.version}</b> · 打包于 ${info.stamp}<br />
      文件大小 <b>${info.sizeText}</b> · 安卓 6.0 及以上
    </div>
  </div>

  <div class="card qr">
    ${info.qrSvg}
    <p>扫一扫直接下载（${info.sizeText}）</p>
  </div>

  <div class="card">
    <h2>安装说明</h2>
    <ul class="tips">
      <li>先把 APK 存到<b>手机本地</b>（文件管理 → 下载目录），再用文件管理器点开安装。</li>
      <li><strong>不要用浏览器或应用商店的「极速安装」「安全安装」</strong>：那类工具会重新签名，之后新版就再也覆盖升级不了。</li>
      <li>装过旧版可以直接覆盖安装，数据不丢；提示「未知来源」时允许一次即可。</li>
    </ul>
    <code>${info.apkUrl}</code>
  </div>

  <p class="links">
    源码 <a href="${info.repoUrl}">${info.repoUrl.replace('https://', '')}</a><br />
    这个网址永远指向最新一版，改完代码重新发布即可。
  </p>
</div>
</body>
</html>
`;
}
