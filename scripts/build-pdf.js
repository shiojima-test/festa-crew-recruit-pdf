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
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const FONT_DIR = path.join(ROOT, 'node_modules', '@fontsource', 'm-plus-rounded-1c', 'files');
const DEFAULT_PAGES_URL = 'https://shiojima-test.github.io/festa-crew-recruit-pdf/';

function readPkgVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

function buildFontFaceCss() {
  const weights = [400, 500, 700, 800, 900];
  return weights.map(w => {
    const file = path.join(FONT_DIR, `m-plus-rounded-1c-japanese-${w}-normal.woff2`);
    const b64 = fs.readFileSync(file).toString('base64');
    return `@font-face{font-family:"M PLUS Rounded 1c";font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
  }).join('\n');
}

(async () => {
  const args = process.argv.slice(2);
  const isLocal = args.includes('--local');
  const VERSION = process.env.VERSION || ('v' + readPkgVersion());
  const VERSION_FS = VERSION.replace(/\./g, '_');  // v7.1 → v7_1

  const fontCss = buildFontFaceCss();
  console.log(`[build-pdf] embedding ${fontCss.length} bytes of font CSS (data: URIs)`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 794, height: 971 },  // 210mm × 257mm @ 96dpi (just for layout hints)
  });
  const page = await context.newPage();

  let url;
  if (isLocal) {
    // 同梱 sample.csv で描画パイプライン全体を検証する (localhost 経由で fetch 可能)
    const csvOverride = process.env.CSV_URL || 'data/sample.csv';
    url = 'http://localhost:4173/?csv=' + encodeURIComponent(csvOverride);
  } else {
    url = process.env.PAGES_URL || DEFAULT_PAGES_URL;
  }
  console.log(`[build-pdf] opening: ${url}`);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

  // フォント完全埋め込み: woff2 を data:URI で注入
  await page.addStyleTag({ content: fontCss });

  // PDF 生成専用の最小オーバーライド (style.css は1文字も改変しない縛り):
  //   - .page の margin/box-shadow は画面表示用で、PDFでは余白として出てしまうので0に
  //   - body 背景は灰なので白に固定 (.page の外側が PDF に映らないように)
  //   - 画面用 download ボタン非表示
  await page.addStyleTag({ content: `
    html, body { background: #fff !important; }
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
})().catch(e => {
  console.error(e);
  process.exit(1);
});
