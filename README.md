# festa-crew-recruit-pdf

フェスタクルー募集チラシ (AB判 210×257mm 1ページ) を、Google スプレッドシートの
CSV をデータソースとして HTML 表示し、Playwright で PDF 化するリポジトリ。

- 公開URL (Pages): https://shiojima-test.github.io/festa-crew-recruit-pdf/
- 最新PDF: https://shiojima-test.github.io/festa-crew-recruit-pdf/dist/festa_crew_recruit_v7_1.pdf
- 過去版PDF: https://github.com/shiojima-test/festa-crew-recruit-pdf/releases

## アーキテクチャ

```
[Google Spreadsheet]
   │ (pub?output=csv)
   ▼
[index.html] ── fetch ──> [src/render.js] ── 動的生成 ──> 下半分カード ×7 + 地図ピン
   │
   │ (Playwright)
   ▼
[scripts/build-pdf.js] ── 210×257mm 1ページ + フォント完全埋込 ──> dist/festa_crew_recruit_<VERSION>.pdf
   │
   │ (GitHub Actions / workflow_dispatch)
   ▼
[GitHub Pages] + [GitHub Releases]
   ▲
   │ (Apps Script: 「フェスタ募集」メニュー → モーダル)
[Spreadsheet GAS Code.gs]
```

### 凍結対象 (改変禁止)

- **`src/style.css`** ... 基準HTML `festa_crew_recruit_v7_1.html` の `<style>` ブロック (行10〜605) を **byte-exact** で複製。
- **index.html の HTML 構造とクラス名** ... `.page` `.hero` `.cards-section` などレイアウト要素は基準HTMLから動かしていない。
- **日本地図 SVG (47 path)** ... `honshu-svg` 配下の path 数を変えない。`scripts/build-pdf.js` は実行時に `document.querySelectorAll('svg path').length === 47` を確認する。

PDF 生成時のみ、`build-pdf.js` が `page.addStyleTag()` で以下の最小オーバーライドを注入する (HTML/CSS には書き込まない):

- `.page { margin: 0 !important; box-shadow: none !important; }` — 画面用の余白・影をPDFでは消す
- `body { background: #fff !important; }` — 画面表示用の dark 背景をPDFでは白に
- `.screen-only-bar { display: none !important; }` — 画面用ダウンロードボタンを隠す

## データソース

スプレッドシートの「ウェブに公開」CSV を fetch。19列スキーマ:

| 列 | 説明 |
|---|---|
| `id` | 行ID (整数) |
| `name` | フェスタ名 (例: はまZOO命の地球フェスタ) |
| `date` | 開催日 (例: 2026.9.23, 範囲表記 2026.7.23-24 もOK) |
| `dateBadge` | 曜日バッジ (例: 水・祝, 金土) |
| `badgeColor` | カード色種別: `teal` / `blue` / `orange` |
| `summary` | カード上部の概要文 |
| `facility` | 施設名 |
| `address` | 住所 (都道府県 市区町村) |
| `sch1Label`〜`sch3Label` | スケジュール各段のラベル (例: 応募締切) |
| `sch1Date`〜`sch3Date` | スケジュール各段の日付 (例: 8/9) |
| `fields` | 募集領域 (カンマ区切り。例: `地域デザイン分野,経営分野,…`) |
| `description` | カード下部の詳細説明文 |
| `mapX` / `mapY` | 地図上ピン座標 (本州 inner SVG viewBox 内の正規化座標 0..1) |
| `pinColor` | ピン色 (#hex) |

### CSV 公開URL

```
https://docs.google.com/spreadsheets/d/e/2PACX-1vQqnMy8b9xeGtJbXyrQUKiy3bJ4ajeyHDhv1s4snvz3LCtdQbpPXgeinLIS6h2FkiQbjMi7EUtNbKpM/pub?output=csv
```

### badgeColor → カードクラス対応

| `badgeColor` | カードクラス | 想定用途 |
|---|---|---|
| `teal` | `.card.zoo` | 動物園・自然系 (#3AABA8) |
| `blue` | `.card.stadium` | スタジアム・スポーツ系 (#2E8EC4) |
| `orange` | `.card.cainz` | 店舗・地域系 (#E88A0A) |

CSV 上で上記以外の値が来た場合は `orange (.cainz)` にフォールバックし、ブラウザコンソールに警告。

### 募集領域タグの対応

CSV `fields` 列の日本語名 → `src/style.css` の `.tag.area-*` クラスへマッピング:

| 日本語 | クラス | 色 |
|---|---|---|
| 地域デザイン分野 | area-region | #3AABA8 |
| 経営分野 | area-biz | #1a3a5c |
| 環境分野 | area-env | #5cab3a |
| 理工分野 | area-sci | #2E8EC4 |
| 教育分野 | area-edu | #E88A0A |
| 介護分野 / 介護・福祉分野 / 介護福祉分野 | area-care | #D4A82C |
| 動物・生命分野 / 動物分野 / 生命分野 | area-bio | #c8569a |
| スポーツ分野 | area-sport | #D14848 |
| ゲーム開発分野 / ゲーム分野 | area-game | #6B4FA8 |

未知の値は `console.warn` で警告、タグ自体は生成しない。

## バージョン規則

- フォーマット: `v<major>.<minor>` (例: `v7.1`, `v7.2`, `v7.10`)
- 起点: 基準HTML が v7.1 のため **v7.1 から**スタート。
- 規則: **更新ごとに +1** (再利用なし)。`v7.1` → `v7.2` → `v7.3` …
- 反映先: ファイル名 `dist/festa_crew_recruit_v<X>_<Y>.pdf`、`package.json` の `version`、画面ヘッダ、PDFタイトル、GitHub Release タグ。
- 自動インクリメント: GAS Dialog が起動時に「次バージョン」を提案。手動編集可。
- 状態保存: Apps Script の `PropertiesService` に `CURRENT_VERSION` を保持。

## 運用手順

### A. スプレッドシートを編集して PDF を生成・公開する (定常運用)

1. スプレッドシートを開く。
2. メニューバー **「フェスタ募集」 → 「PDFを生成・表示」**。
3. モーダルが開き、次バージョン (例 `v7.2`) が自動入力される。問題なければそのまま「**この内容で生成する**」をクリック。
4. 「workflow_dispatch を送信中…」→「Actions の起動を待機中…」→「実行中… (status=…)」 と進む。
5. 1〜3分後 **「完了しました」** の表示と共に **「PDFを開く (Pages)」** と **「Releaseページ」** のボタンが現れる。クリックでブラウザに開く。
6. Pages 反映には Actions 完了後さらに 1〜3 分かかる場合がある。即時にPDFを見たい場合は Releaseページ側からダウンロードする。

### B. 過去版や最新版を再生成なしで開く

スプレッドシート → 「フェスタ募集」 → 「**最新PDFを開く (再生成なし)**」 → ボタンクリック。

### C. ローカル開発で PDF を生成・確認する

```bash
# リポジトリを clone
git clone git@github.com:shiojima-test/festa-crew-recruit-pdf.git
cd festa-crew-recruit-pdf

npm install
npx playwright install chromium

# ローカル検証 (data/sample.csv を使う。本番CSVに依存しない)
VERSION=v7.1 npm run build:local

# 本番CSVを使った生成 (要・CSVが公開済み)
VERSION=v7.2 npm run build
```

生成物: `dist/festa_crew_recruit_<VERSION>.pdf`

`build:local` は同梱 `data/sample.csv` を使う。本番CSVが未整備の時の動作検証に使用。

### D. ブラウザで画面表示する

`npm run serve` でローカル静的サーバ (`http://localhost:4173/`) を起動して、Chrome/Edge で開く。右上の **「PDFダウンロード」** ボタンで最新の Pages 上のPDFをダウンロードできる (このボタンはPDF生成時のみ非表示)。

Pages 公開URL: https://shiojima-test.github.io/festa-crew-recruit-pdf/

## Apps Script セットアップ (初回のみ)

1. スプレッドシートを開く。
2. メニュー **「拡張機能」 → 「Apps Script」** を選択。新規 Apps Script プロジェクトが開く。
3. 左サイドバーで `コード.gs` (デフォルト) を選択し、中身を **`gas/Code.gs` の内容** で完全に置換。保存。
4. 左サイドバーの「ファイル」横の **「＋」 → 「HTML」** をクリック。ファイル名は **`Dialog`** (拡張子 .html は自動付与) で作成。
5. 開いた `Dialog.html` の中身を **`gas/Dialog.html` の内容** で完全に置換。保存。
6. 左サイドバー下部の歯車アイコン **「プロジェクトの設定」** を開く。
7. 「**スクリプト プロパティ**」 → 「**スクリプト プロパティを編集**」 → 「**プロパティを追加**」:
   - プロパティ: `GITHUB_TOKEN` / 値: GitHub PAT (例: `ghp_***`)
   - 保存。
8. スプレッドシートに戻り、**再読み込み** すると「フェスタ募集」メニューが表示される。
9. 初回のみ Google の認可ダイアログが出る。「許可」 (UrlFetchApp と HTMLサービスの権限)。
10. これで「フェスタ募集 → PDFを生成・表示」が使えるようになる。

### PAT (GitHub Personal Access Token)

- 現行 PAT は **2026-06-04 失効予定**。失効が近づいたら塩島さんに再発行を依頼し、ステップ 7 の `GITHUB_TOKEN` を更新する。
- スコープ: `repo` (workflow_dispatch・dist/ への push・Release作成のため)。

## ファイル構成

| パス | 役割 |
|---|---|
| `index.html` | 画面表示用のエントリ。基準HTMLからCSS抽出済み、cards-gridは空コンテナ |
| `src/style.css` | 基準HTML v7.1 の `<style>` をbyte-exactで保持。**改変禁止** |
| `src/render.js` | CSV fetch → カード生成 → ピン生成 |
| `data/sample.csv` | 開発用フィクスチャ (本番CSV障害時の検証用) |
| `scripts/build-pdf.js` | Playwright PDF 生成 (フォント埋込 + 印刷用CSS注入) |
| `scripts/serve.js` | ローカル開発用静的サーバ |
| `.github/workflows/build-pdf.yml` | GitHub Actions (workflow_dispatch) |
| `gas/Code.gs` | GAS サーバサイド (workflow_dispatch + ポーリング) |
| `gas/Dialog.html` | GAS モーダル UI |
| `dist/festa_crew_recruit_<VERSION>.pdf` | 自動生成PDF (Pages 配信 + Release 添付) |

## ライセンス

MIT
