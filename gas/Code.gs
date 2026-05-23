/**
 * フェスタクルー募集 — スプレッドシート連携 GAS
 *
 * - シート起動時に「フェスタ募集」メニューを追加
 * - 「PDFを生成・表示」で GitHub Actions (build-pdf.yml) を workflow_dispatch
 * - 完了をポーリングし、Pages / Releases のPDF URLをモーダルで表示
 *
 * 事前設定 (Apps Script の「プロジェクトの設定 → スクリプト プロパティ」):
 *   GITHUB_TOKEN   ... GitHub PAT (repo scope)
 *   CURRENT_VERSION (任意) ... 最後に生成したバージョン (例: v7.1)。
 *                              無ければ DEFAULT_VERSION を使う。
 */

const REPO = 'shiojima-test/festa-crew-recruit-pdf';
const WORKFLOW_FILE = 'build-pdf.yml';
const REF = 'main';
const DEFAULT_VERSION = 'v7.1';
const PAGES_BASE = 'https://shiojima-test.github.io/festa-crew-recruit-pdf';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('フェスタ募集')
    .addItem('PDFを生成・表示', 'showGenerateDialog')
    .addSeparator()
    .addItem('最新PDFを開く (再生成なし)', 'openLatestPdf')
    .addToUi();
}

function showGenerateDialog() {
  const html = HtmlService.createHtmlOutputFromFile('Dialog')
    .setWidth(520)
    .setHeight(420);
  SpreadsheetApp.getUi().showModalDialog(html, 'PDFを生成');
}

// クライアントから最初に呼ばれる: 次バージョンを返す
function getProposedVersion() {
  const props = PropertiesService.getScriptProperties();
  const current = props.getProperty('CURRENT_VERSION') || DEFAULT_VERSION;
  const next = bumpVersion_(current);
  return { current: current, next: next };
}

// "v7.1" → "v7.2", "v7.9" → "v7.10", "v7" → "v7.1"
function bumpVersion_(v) {
  const m = /^v(\d+)(?:\.(\d+))?$/.exec(v.trim());
  if (!m) throw new Error('不正なバージョン形式: ' + v);
  const major = parseInt(m[1], 10);
  const minor = m[2] != null ? parseInt(m[2], 10) : 0;
  return 'v' + major + '.' + (minor + 1);
}

// workflow_dispatch を投げる。返り値: dispatchedAt (ISO)
function startWorkflow(version) {
  if (!/^v\d+(\.\d+)?$/.test(version)) throw new Error('不正なバージョン: ' + version);
  const token = requireToken_();
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const body = { ref: REF, inputs: { version: version, do_release: 'true' } };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'token ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 204) throw new Error('workflow_dispatch 失敗 HTTP=' + code + ' body=' + res.getContentText());
  return { dispatchedAt: new Date().toISOString(), version: version };
}

// 直近の workflow_dispatch 実行を取得 (作成日時 >= dispatchedAt のもの)
function findRecentRun(dispatchedAt) {
  const token = requireToken_();
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=10`;
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return null;
  const json = JSON.parse(res.getContentText());
  const runs = (json.workflow_runs || []).filter(r => new Date(r.created_at).getTime() >= new Date(dispatchedAt).getTime() - 5000);
  if (!runs.length) return null;
  const r = runs[0];
  return { id: r.id, status: r.status, conclusion: r.conclusion, html_url: r.html_url, created_at: r.created_at };
}

// 個別 run の状態取得 (ポーリング用)
function getRunStatus(runId) {
  const token = requireToken_();
  const url = `https://api.github.com/repos/${REPO}/actions/runs/${runId}`;
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('run status fetch HTTP=' + res.getResponseCode());
  const r = JSON.parse(res.getContentText());
  return { id: r.id, status: r.status, conclusion: r.conclusion, html_url: r.html_url };
}

// 成功時の URL 生成 (Pages 直リンク・Release リリースページ)
function buildResultUrls(version) {
  const fs = version.replace(/\./g, '_');
  return {
    pages: `${PAGES_BASE}/dist/festa_crew_recruit_${fs}.pdf`,
    release: `https://github.com/${REPO}/releases/tag/${version}`,
    actionsRun: `https://github.com/${REPO}/actions`,
  };
}

// 成功後、保存済みバージョンを更新
function commitVersion(version) {
  PropertiesService.getScriptProperties().setProperty('CURRENT_VERSION', version);
  return true;
}

function openLatestPdf() {
  const ui = SpreadsheetApp.getUi();
  const current = PropertiesService.getScriptProperties().getProperty('CURRENT_VERSION') || DEFAULT_VERSION;
  const urls = buildResultUrls(current);
  const html = HtmlService.createHtmlOutput(
    `<div style="font-family:system-ui;padding:14px;font-size:13px;">
      <div style="margin-bottom:10px;">最新版: <b>${current}</b></div>
      <div style="margin-bottom:8px;">
        <a href="${urls.pages}" target="_blank" rel="noopener" style="display:inline-block;padding:8px 14px;background:#3AABA8;color:#fff;text-decoration:none;border-radius:5px;font-weight:700;">PDFを開く (Pages)</a>
      </div>
      <div style="margin-bottom:8px;">
        <a href="${urls.release}" target="_blank" rel="noopener" style="display:inline-block;padding:8px 14px;background:#1a3a5c;color:#fff;text-decoration:none;border-radius:5px;font-weight:700;">Releaseページを開く</a>
      </div>
      <div style="color:#888;font-size:11px;margin-top:14px;">
        ※ Pages反映には Actions 完了後さらに 1〜3分かかります。
      </div>
    </div>`
  ).setWidth(420).setHeight(260);
  ui.showModalDialog(html, '最新PDF');
}

function requireToken_() {
  const t = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!t) throw new Error('スクリプトプロパティ GITHUB_TOKEN が未設定です。Apps Script の「プロジェクトの設定 → スクリプトプロパティ」に PAT を登録してください。');
  return t;
}
