(function () {
  'use strict';

  // ?csv=... で上書き可 (ローカル検証時に同梱の sample.csv を使うため)
  const CSV_DEFAULT = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQqnMy8b9xeGtJbXyrQUKiy3bJ4ajeyHDhv1s4snvz3LCtdQbpPXgeinLIS6h2FkiQbjMi7EUtNbKpM/pub?output=csv';
  const CSV_URL = (new URLSearchParams(location.search).get('csv')) || CSV_DEFAULT;

  // badgeColor 値 → 基準HTMLのカードクラス
  const BADGE_TO_CLASS = {
    teal: 'zoo',
    blue: 'stadium',
    orange: 'cainz',
  };

  // CSV の fields 列の日本語表記 → style.css の area-* クラス
  const FIELD_TO_TAG = {
    '地域デザイン分野': 'area-region',
    '経営分野': 'area-biz',
    '環境分野': 'area-env',
    '理工分野': 'area-sci',
    '教育分野': 'area-edu',
    '介護分野': 'area-care',
    '介護・福祉分野': 'area-care',
    '介護福祉分野': 'area-care',
    '動物・生命分野': 'area-bio',
    '動物分野': 'area-bio',
    '生命分野': 'area-bio',
    'スポーツ分野': 'area-sport',
    'ゲーム開発分野': 'area-game',
    'ゲーム分野': 'area-game',
  };

  // 文字数上限 (超えたら console.warn で警告)
  const LIMITS = {
    name: 18,
    summary: 40,
    facility: 24,
    address: 18,
    description: 110,
  };

  // RFC 4180 準拠の CSV パーサ
  // - 引用符 " で囲まれたフィールド内の , / 改行 / "" を正しく扱う
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false, i = 0;
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  function rowsToObjects(rows) {
    if (!rows.length) return [];
    const header = rows[0].map(h => h.trim());
    return rows.slice(1)
      .filter(r => r.some(c => (c || '').trim() !== ''))
      .map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] != null ? String(r[i]) : '').trim()])));
  }

  function el(tag, opts, children) {
    opts = opts || {}; children = children || [];
    const e = document.createElement(tag);
    if (opts.className) e.className = opts.className;
    if (opts.text != null) e.textContent = opts.text;
    if (opts.html != null) e.innerHTML = opts.html;
    if (opts.id) e.id = opts.id;
    if (opts.style) for (const k in opts.style) e.style[k] = opts.style[k];
    if (opts.attrs) for (const k in opts.attrs) e.setAttribute(k, opts.attrs[k]);
    for (let i = 0; i < children.length; i++) if (children[i]) e.appendChild(children[i]);
    return e;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // v7.2: qrcode-generator で同期的に QR の data URI を作る
  // typeNumber=0 (自動)、errorCorrectionLevel='M'。
  // QRCode-generator は引数 (cellSize, margin) で PNG data URI を返す。
  function generateQrDataUri(text) {
    try {
      // global qrcode は vendor/qrcode.js (qrcode-generator) が公開
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      // cellSize=4, margin=2 → 約 100-130px の PNG data URI を生成
      return qr.createDataURL(4, 2);
    } catch (e) {
      console.warn('[render] QR generation failed for url=' + text + ':', e);
      return '';
    }
  }

  function warnIfTooLong(value, field, id) {
    const limit = LIMITS[field];
    if (limit != null && value && value.length > limit) {
      console.warn(`[render] row id=${id} field=${field} length=${value.length} exceeds limit=${limit}: "${value}"`);
    }
  }

  function buildCard(row) {
    const id = row.id || '?';
    let cardClass = BADGE_TO_CLASS[row.badgeColor];
    if (!cardClass) {
      console.warn(`[render] row id=${id} unknown badgeColor="${row.badgeColor}", falling back to "cainz" (orange)`);
      cardClass = 'cainz';
    }

    warnIfTooLong(row.name, 'name', id);
    warnIfTooLong(row.summary, 'summary', id);
    warnIfTooLong(row.facility, 'facility', id);
    warnIfTooLong(row.address, 'address', id);
    warnIfTooLong(row.description, 'description', id);

    const card = el('div', { className: 'card ' + cardClass });

    card.appendChild(el('div', { className: 'c-head' }, [
      el('div', { className: 'c-festa-tag', text: 'FESTA' }),
      el('div', { className: 'c-event', text: row.name || '' }),
    ]));

    card.appendChild(el('div', { className: 'c-date-bar' }, [
      el('span', { text: row.date || '' }),
      el('span', { className: 'c-day', text: row.dateBadge || '' }),
    ]));

    card.appendChild(el('div', { className: 'c-intro', text: row.summary || '' }));

    const body = el('div', { className: 'c-body' });

    // c-loc-row: LOCATION + (qrUrl があれば) QR コード
    const locRowChildren = [
      el('div', { className: 'c-loc-left' }, [
        el('div', { className: 'c-section', text: '▎ LOCATION' }),
        el('div', {
          className: 'c-loc',
          html: '<span class="c-fac">' + escapeHtml(row.facility || '') + '</span><br>' +
                '<span class="c-addr">' + escapeHtml(row.address || '') + '</span>',
        }),
      ]),
    ];
    // v7.2: qrUrl 列があれば QR コードを生成 (qrcode-generator で synchronous data URI)
    // qrUrl が空なら c-qr-box ごと出さない → c-loc-left が幅いっぱい使う
    const qrUrl = (row.qrUrl || '').trim();
    if (qrUrl) {
      const qrDataUri = generateQrDataUri(qrUrl);
      locRowChildren.push(
        el('div', { className: 'c-qr-box' }, [
          el('img', { className: 'c-qr', attrs: { src: qrDataUri, alt: 'QR' } }),
          el('span', { className: 'c-qr-text', text: '詳細はこちら' }),
        ])
      );
    }
    body.appendChild(el('div', { className: 'c-loc-row' }, locRowChildren));

    body.appendChild(el('div', { className: 'c-section', text: '▎ SCHEDULE' }));
    const sched = el('div', { className: 'c-schedC' });
    for (let i = 1; i <= 3; i++) {
      const lbl = row['sch' + i + 'Label'];
      const val = row['sch' + i + 'Date'];
      if (!lbl && !val) continue;
      sched.appendChild(el('div', { className: 'c-itemC c' + i }, [
        el('span', { className: 'c-cLbl', text: lbl || '' }),
        el('span', { className: 'c-cVal', text: val || '' }),
      ]));
    }
    body.appendChild(sched);

    body.appendChild(el('div', { className: 'c-section', text: '▎ 募集領域' }));
    const tagGroup = el('div', { className: 'c-tag-group' });
    const fields = (row.fields || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const f of fields) {
      const cls = FIELD_TO_TAG[f];
      if (!cls) {
        console.warn(`[render] row id=${id} unknown field tag "${f}" — skipping`);
        continue;
      }
      tagGroup.appendChild(el('div', { className: 'tag ' + cls, text: f }));
    }
    body.appendChild(tagGroup);

    body.appendChild(el('div', { className: 'c-area-summary', text: row.description || '' }));

    card.appendChild(body);
    return card;
  }

  // 基準HTML inline <script> のピン生成ロジックをそのまま移植
  function renderPins(rows) {
    const honshuSvg = document.getElementById('honshu-svg');
    if (!honshuSvg) return;
    const wrap = document.getElementById('map-wrap');
    const honshuRect = honshuSvg.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();

    // 本州inner SVGのviewBox: 0.06 -0.01 0.72 0.78 (基準HTMLと完全一致)
    const innerVbX = 0.06, innerVbY = -0.01, innerVbW = 0.72, innerVbH = 0.78;
    const innerW = honshuRect.width, innerH = honshuRect.height;
    const scale = Math.min(innerW / innerVbW, innerH / innerVbH);
    const drawW = innerVbW * scale;
    const drawH = innerVbH * scale;
    const offsetX = (innerW - drawW) / 2;
    const offsetY = (innerH - drawH) / 2;
    const innerLeftInWrap = honshuRect.left - wrapRect.left;
    const innerTopInWrap = honshuRect.top - wrapRect.top;

    function toPixel(vx, vy) {
      return {
        x: innerLeftInWrap + offsetX + (vx - innerVbX) * scale,
        y: innerTopInWrap + offsetY + (vy - innerVbY) * scale,
      };
    }

    const pinsContainer = document.getElementById('pins');
    while (pinsContainer.firstChild) pinsContainer.removeChild(pinsContainer.firstChild);

    rows.forEach((row) => {
      const vx = parseFloat(row.mapX);
      const vy = parseFloat(row.mapY);
      if (!isFinite(vx) || !isFinite(vy)) {
        console.warn(`[render] row id=${row.id} invalid mapX/mapY: "${row.mapX}" / "${row.mapY}"`);
        return;
      }
      const color = row.pinColor || '#3AABA8';
      const p = toPixel(vx, vy);
      const pinDiv = el('div', { className: 'pin-group', style: { left: p.x + 'px', top: p.y + 'px' } });
      pinDiv.appendChild(el('div', { className: 'pin-shadow' }));
      pinDiv.appendChild(el('div', { className: 'pin-core', style: { background: color } }));
      pinsContainer.appendChild(pinDiv);
    });
  }

  async function init() {
    let text;
    try {
      const res = await fetch(CSV_URL, { credentials: 'omit', cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      text = await res.text();
    } catch (e) {
      console.error('[render] CSV fetch failed:', e);
      const grid = document.getElementById('cards-grid');
      grid.innerHTML =
        '<div style="grid-column: 1/-1; padding: 8mm; color:#c0392b; font-size:11px;">' +
        'CSVの取得に失敗しました: ' + escapeHtml(e.message || String(e)) +
        '</div>';
      document.body.dataset.error = 'csv-fetch';
      return;
    }

    const rows = rowsToObjects(parseCSV(text));
    console.log('[render] loaded ' + rows.length + ' rows from CSV');

    const grid = document.getElementById('cards-grid');
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    rows.forEach(r => grid.appendChild(buildCard(r)));

    renderPins(rows);

    // Playwright が待機できるよう、描画完了を data 属性で告知
    document.body.dataset.rendered = String(rows.length);
  }

  // pin geometry は load 後 (フォント・SVGレイアウトが確定したあと) に走らせる
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
