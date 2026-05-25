/*
 * Playwright で index.html を AB判(210mm × 257mm) 1ページPDFに変換する。
 * - @fontsource/m-plus-rounded-1c の japanese-subset woff2 を data:URI で
 *   @font-face 注入し、PDF にフォントを完全埋め込みする (HTMLは触らない)。
 * - body.dataset.rendered が CSV 行数に等しくなるまで描画完了を待機。
 *
 * 出力: dist/festa_crew_recruit_<VERSION>.pdf
 *   - VERSION は環境変数。未指定なら package.json の version から導出。
 *   - --local オプションで file:// から index.html を開く (ローカル検証用)。
 *   - 通常モードは PAGES_URL (= GitHub Pages の本番URL) から開く想定。
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const FONT_DIR_MPLUS = path.join(ROOT, 'node_modules', '@fontsource', 'm-plus-rounded-1c', 'files');
const FONT_DIR_NOTO  = path.join(ROOT, 'node_modules', '@fontsource', 'noto-sans-jp', 'files');
const DEFAULT_PAGES_URL = 'https://shiojima-test.github.io/festa-crew-recruit-pdf/';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf',
};

function startInlineServer(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/' || p === '') p = '/index.html';
      const full = path.join(ROOT, p);
      if (!full.startsWith(ROOT)) { res.statusCode = 403; res.end('forbidden'); return; }
      fs.readFile(full, (err, data) => {
        if (err) { res.statusCode = 404; res.end('not found'); return; }
        res.setHeader('Content-Type', MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
        res.end(data);
      });
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function readPkgVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

function buildFontFaceCss() {
  // M PLUS Rounded 1c (上半分: タイトル等) と Noto Sans JP (下半分: カード) を data:URI で埋込
  const weights = [400, 500, 700, 800, 900];
  const out = [];
  for (const w of weights) {
    const mpFile = path.join(FONT_DIR_MPLUS, `m-plus-rounded-1c-japanese-${w}-normal.woff2`);
    if (fs.existsSync(mpFile)) {
      const b64 = fs.readFileSync(mpFile).toString('base64');
      out.push(`@font-face{font-family:"M PLUS Rounded 1c";font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2");}`);
    }
    const ntFile = path.join(FONT_DIR_NOTO, `noto-sans-jp-japanese-${w}-normal.woff2`);
    if (fs.existsSync(ntFile)) {
      const b64 = fs.readFileSync(ntFile).toString('base64');
      out.push(`@font-face{font-family:"Noto Sans JP";font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2");}`);
    }
  }
  return out.join('\n');
}

(async () => {
  const args = process.argv.slice(2);
  const isLocal = args.includes('--local');
  const VERSION = process.env.VERSION || ('v' + readPkgVersion());
  const VERSION_FS = VERSION.replace(/\./g, '_');  // v7.1 → v7_1

  const fontCss = buildFontFaceCss();
  console.log(`[build-pdf] embedding ${fontCss.length} bytes of font CSS (data: URIs)`);

  // インラインHTTPサーバを起動 (file:// だと fetch/CORS が不安定なので)
  const PORT = parseInt(process.env.PORT || '4173', 10);
  const server = await startInlineServer(PORT);
  console.log(`[build-pdf] inline server on http://127.0.0.1:${PORT}/`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 794, height: 971 },  // 210mm × 257mm @ 96dpi
  });
  const page = await context.newPage();

  let url;
  if (process.env.PAGES_URL) {
    // 本番Pages URL でレンダリング (任意指定。通常はインラインサーバを使う)
    url = process.env.PAGES_URL;
  } else if (isLocal) {
    // 開発: 同梱 sample.csv で描画パイプライン全体を検証 (本番CSVがまだ整わない時用)
    const csvOverride = process.env.CSV_URL || 'data/sample.csv';
    url = `http://127.0.0.1:${PORT}/?csv=${encodeURIComponent(csvOverride)}`;
  } else {
    // CI: localhost に index.html を配信し、render.js が本番CSV(pub?output=csv)を取得
    url = `http://127.0.0.1:${PORT}/`;
  }
  console.log(`[build-pdf] opening: ${url}`);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

  // フォント完全埋め込み: woff2 を data:URI で注入
  await page.addStyleTag({ content: fontCss });

  // PDF 生成専用の最小オーバーライド (style.css は1文字も改変しない縛り):
  //   - .page の margin/box-shadow は画面表示用で、PDFでは余白として出てしまうので0に
  //   - body 背景は灰なので白に固定 (.page の外側が PDF に映らないように)
  //   - 画面用 download ボタン非表示
  // html/body 背景はフッター色 #1f2a30 に固定する。
  // 理由: Playwright/Chromium が出力する PDF ページは指定 257mm より約 0.21mm
  // 大きく (Skia/PDF の rounding)、.page (CSS 257mm) は PDF ページ下端まで届かない。
  // 背後 (html/body) を footer と同色にしておけば、その 2-3px のサブピクセル
  // ギャップが見えず、フッター帯が下端までぴったり繋がる。サイドの 1px ギャップも
  // 同様に同色で消える (元は body bg #fff 由来で白く透けていた)。
  await page.addStyleTag({ content: `
    html, body { background: #1f2a30 !important; }
    .page { margin: 0 !important; box-shadow: none !important; }
    .screen-only-bar { display: none !important; }
  `});

  // render.js が CSV 取得後に body.dataset.rendered を設定するのを待つ
  await page.waitForFunction(() => {
    const v = document.body.dataset.rendered;
    return v != null && Number(v) > 0;
  }, null, { timeout: 30_000 });

  // PDF 化中はダウンロードボタン等を確実に隠す
  await page.evaluate(() => { document.body.classList.add('is-pdf'); });

  // フォント読み込みの確定
  await page.evaluate(async () => { await document.fonts.ready; });

  // 印刷メディアエミュレーション (CSS の @media print が効くように)
  await page.emulateMedia({ media: 'print' });

  // 描画完了マーカー
  const rendered = await page.evaluate(() => document.body.dataset.rendered);
  const pinCount = await page.evaluate(() => document.querySelectorAll('#pins .pin-group').length);
  const cardCount = await page.evaluate(() => document.querySelectorAll('.cards-grid > .card').length);
  const pathCount = await page.evaluate(() => document.querySelectorAll('svg path').length);
  console.log(`[build-pdf] cards=${cardCount} pins=${pinCount} svg.paths=${pathCount} (rendered=${rendered})`);

  const outDir = path.join(ROOT, 'dist');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `festa_crew_recruit_${VERSION_FS}.pdf`);

  await page.pdf({
    path: outPath,
    width: '210mm',
    height: '257mm',
    printBackground: true,
    margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    preferCSSPageSize: false,
  });

  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`[build-pdf] PDF generated: ${outPath} (${kb} KB)`);

  await browser.close();
  await new Promise(r => server.close(r));
})().catch(e => {
  console.error(e);
  process.exit(1);
});
