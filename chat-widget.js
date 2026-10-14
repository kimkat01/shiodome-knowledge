/* ============================================================
   しおどめチャット（園長ダッシュボード ⇔ 本部）  2026-10
   置き場所：kimkat01/shiodome-knowledge リポジトリの一番上（chat-widget.js）
   読み込み：<script src="https://kimkat01.github.io/shiodome-knowledge/chat-widget.js"></script>
   使う場所：園長ダッシュボード（shiodome-knowledge/index.html）と本部ダッシュボード（honbu-dashboard/index.html）

   ・部屋は「その園 ⇔ 本部」の1対1。ほかの園からは見えない
   ・右下の 💬 ボタンで開く。未読があると赤い数字が出る（30秒ごとに確認）
   ・本部側は全園の部屋の一覧から選ぶ。未読のある園が上に来る
   ・送信：「送信」ボタン、または Ctrl+Enter（Enterだけなら改行）
   ・記録はGAS「しおどめチャット」（cryk0289）→ スプレッドシート「しおどめチャット 記録」

   ★ CHAT_GAS_URL が空のあいだは、ボタンも何も表示しない（準備中）
   ============================================================ */
(function () {
  var CHAT_GAS_URL = 'https://script.google.com/macros/s/AKfycbzFS-2kyU8tOqqa7obTsn475IoPxqtF8U-mmIbkfTe0WL2FUyNhhr-pMf7Cex6eFyF7/exec';   // ← GAS「しおどめチャット」をデプロイしたら /exec のURLをここに貼る

  var POLL_SUMMARY_MS = 30000;   // 未読の確認間隔
  var POLL_ROOM_MS = 8000;       // 部屋を開いているときの更新間隔
  var NAME_KEY = 'shiodome_chat_honbu_name';

  var cfg = null, state = {
    open: false, room: null, rooms: {}, total: 0, msgs: [], otherRead: 0,
    sending: false, lastRoomSig: '', timers: []
  };

  /* ---------- 小道具 ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function $(id) { return document.getElementById(id); }
  function gardens() { return (typeof GARDEN_MASTER !== 'undefined' && Array.isArray(GARDEN_MASTER)) ? GARDEN_MASTER : []; }
  function gardenName(code) {
    var g = gardens().filter(function (x) { return x.code === code; })[0];
    return g ? g.name : code;
  }
  /* 送り主に出す短い園名：「しおどめ保育園」などを除く（例：しおどめ保育園八潮駅北→八潮駅北、守谷しおどめ保育園→守谷） */
  function shortName(name) {
    var n = String(name || '');
    if (n === 'ふれあいしおどめ保育園') return 'ふれあい守谷';   // 八潮のふれあいと区別するため
    if (/しおどめ保育園/.test(n)) n = n.replace('しおどめ保育園', '');
    else if (/^認定こども園/.test(n)) n = n.replace(/^認定こども園/, '');
    else n = n.replace('しおどめ', '').replace('保育園', '');
    return n.replace(/^[\s　]+|[\s　]+$/g, '') || String(name || '');
  }
  function user() { var u = (cfg.user && cfg.user()) || {}; return { loginId: String(u.loginId || ''), name: String(u.name || '') }; }
  function honbuName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtDay(ts) {
    var d = new Date(ts), t = new Date();
    var same = function (a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
    var y = new Date(t); y.setDate(t.getDate() - 1);
    if (same(d, t)) return '今日';
    if (same(d, y)) return '昨日';
    return (d.getFullYear() !== t.getFullYear() ? d.getFullYear() + '/' : '') + (d.getMonth() + 1) + '/' + d.getDate() + '（' + '日月火水木金土'.charAt(d.getDay()) + '）';
  }
  function fmtList(ts) { return !ts ? '' : (fmtDay(ts) === '今日' ? fmtTime(ts) : fmtDay(ts).replace(/（.）/, '')); }

  function apiGet(params) {
    var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(CHAT_GAS_URL + '?' + q + '&t=' + Date.now(), { redirect: 'follow' })
      .then(function (r) { return r.text(); })
      .then(function (t) { var d = JSON.parse(t); if (!d.ok) throw new Error(d.message || '読み込みに失敗しました'); return d; });
  }
  function apiPost(data) {
    return fetch(CHAT_GAS_URL, { method: 'POST', body: JSON.stringify(data), redirect: 'follow' })
      .then(function (r) { return r.text(); })
      .then(function (t) { var d = null; try { d = JSON.parse(t); } catch (e) {} if (!d) throw new Error('サーバーの応答を読み取れませんでした'); if (!d.ok) throw new Error(d.message || '送信に失敗しました'); return d; });
  }

  /* ---------- 見た目 ---------- */
  function injectCss() {
    var css = '' +
      '.sdc-fab{position:fixed;right:22px;bottom:22px;z-index:9000;width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;background:var(--sdc-accent);color:#fff;font-size:26px;box-shadow:0 8px 24px rgba(20,30,70,.28);display:flex;align-items:center;justify-content:center;transition:transform .15s}' +
      '.sdc-fab:hover{transform:scale(1.06)}' +
      '.sdc-badge{position:absolute;top:-4px;right:-4px;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#e5383b;color:#fff;font-size:13px;font-weight:700;line-height:22px;text-align:center;box-shadow:0 0 0 2px #fff}' +
      '.sdc-badge[hidden]{display:none}' +
      '.sdc-panel{position:fixed;right:22px;bottom:92px;z-index:9001;width:390px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 120px);background:#fff;color:#1b2340;border-radius:18px;box-shadow:0 18px 50px rgba(20,30,70,.32);display:none;flex-direction:column;overflow:hidden;font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif;font-size:15px}' +
      '.sdc-panel.show{display:flex}' +
      '.sdc-head{display:flex;align-items:center;gap:8px;padding:12px 14px;background:var(--sdc-accent);color:#fff}' +
      '.sdc-head b{flex:1;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.sdc-hbtn{background:rgba(255,255,255,.18);border:none;color:#fff;border-radius:8px;height:32px;min-width:32px;padding:0 8px;cursor:pointer;font-size:15px}' +
      '.sdc-hbtn:hover{background:rgba(255,255,255,.3)}' +
      '.sdc-body{flex:1;overflow-y:auto;background:#f3f5fa}' +
      '.sdc-room{display:flex;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid #e6e9f2;background:#fff;cursor:pointer}' +
      '.sdc-room:hover{background:#f7f8fc}' +
      '.sdc-room .nm{font-weight:700;font-size:15px}' +
      '.sdc-room .pv{font-size:13px;color:#5b6280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}' +
      '.sdc-room .mt{flex:1;min-width:0}' +
      '.sdc-room .rt{text-align:right;font-size:12px;color:#7b81a0;flex:none}' +
      '.sdc-room .ub{display:inline-block;margin-top:4px;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#e5383b;color:#fff;font-weight:700;font-size:13px;line-height:22px;text-align:center}' +
      '.sdc-room.has-unread .nm{color:var(--sdc-accent)}' +
      '.sdc-sec{padding:8px 14px 6px;font-size:12px;color:#7b81a0;font-weight:700;background:#f3f5fa}' +
      '.sdc-msgs{padding:12px 12px 4px}' +
      '.sdc-day{text-align:center;margin:10px 0;font-size:12px;color:#7b81a0}' +
      '.sdc-day span{background:#e4e8f2;border-radius:10px;padding:2px 10px}' +
      '.sdc-m{display:flex;flex-direction:column;margin:6px 0;max-width:82%}' +
      '.sdc-m.mine{margin-left:auto;align-items:flex-end}' +
      '.sdc-m .who{font-size:12px;color:#5b6280;margin:0 4px 2px}' +
      '.sdc-m .row{display:flex;align-items:flex-end;gap:6px}' +
      '.sdc-m.mine .row{flex-direction:row-reverse}' +
      '.sdc-m .bub{padding:9px 12px;border-radius:16px;background:#fff;color:#000;white-space:pre-wrap;word-break:break-word;line-height:1.55;box-shadow:0 1px 2px rgba(20,30,70,.08)}' +
      '.sdc-m.mine .bub{background:var(--sdc-accent);color:#fff;border-bottom-right-radius:4px}' +
      '.sdc-m:not(.mine) .bub{border-bottom-left-radius:4px}' +
      '.sdc-m .meta{font-size:11px;color:#7b81a0;white-space:nowrap;display:flex;flex-direction:column;align-items:flex-end;gap:1px}' +
      '.sdc-m:not(.mine) .meta{align-items:flex-start}' +
      '.sdc-del{border:none;background:none;color:#9aa0b8;cursor:pointer;font-size:11px;padding:0;visibility:hidden}' +
      '.sdc-m:hover .sdc-del{visibility:visible}' +
      '.sdc-del:hover{color:#e5383b}' +
      '.sdc-empty{padding:40px 20px;text-align:center;color:#7b81a0;font-size:14px;line-height:1.8}' +
      '.sdc-foot{border-top:1px solid #e6e9f2;background:#fff;padding:8px 10px}' +
      '.sdc-namebar{display:flex;align-items:center;gap:6px;font-size:13px;color:#5b6280;margin-bottom:6px}' +
      '.sdc-namebar input{flex:1;border:1px solid #d5d9e6;border-radius:8px;padding:5px 8px;font-size:14px;color:#000}' +
      '.sdc-comp{display:flex;gap:8px;align-items:flex-end}' +
      '.sdc-comp textarea{flex:1;resize:none;border:1px solid #d5d9e6;border-radius:12px;padding:8px 10px;font-size:15px;line-height:1.5;color:#000;font-family:inherit;height:42px;min-height:42px;max-height:140px;overflow-y:auto;outline:none;box-sizing:border-box}' +
      '.sdc-comp textarea:focus{border-color:var(--sdc-accent)}' +
      '.sdc-send{border:none;border-radius:12px;background:var(--sdc-accent);color:#fff;font-weight:700;font-size:15px;height:42px;padding:0 16px;cursor:pointer}' +
      '.sdc-send:disabled{opacity:.45;cursor:default}' +
      '.sdc-hint{font-size:11px;color:#9aa0b8;margin-top:4px}' +
      '.sdc-err{color:#e5383b;font-size:13px;padding:6px 14px;background:#fff1f1;display:none}' +
      '.sdc-err.show{display:block}' +
      '@media (max-width:520px){.sdc-panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}.sdc-fab{right:16px;bottom:16px}}';
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  function build() {
    var root = document.documentElement;
    root.style.setProperty('--sdc-accent', cfg.accent || '#3a63d8');

    var fab = document.createElement('button');
    fab.className = 'sdc-fab'; fab.id = 'sdcFab'; fab.type = 'button';
    fab.title = cfg.side === 'honbu' ? '園長とのチャット' : '本部とのチャット';
    fab.innerHTML = '💬<span class="sdc-badge" id="sdcFabBadge" hidden>0</span>';
    fab.onclick = function () { state.open ? close() : open(); };
    if (cfg.showFab === false) fab.style.display = 'none';   // メニューやカードから開くときは💬ボタンを出さない

    var panel = document.createElement('div');
    panel.className = 'sdc-panel'; panel.id = 'sdcPanel';
    panel.innerHTML =
      '<div class="sdc-head">' +
        '<button class="sdc-hbtn" id="sdcBack" title="園の一覧へ" style="display:none">‹</button>' +
        '<b id="sdcTitle"></b>' +
        '<button class="sdc-hbtn" id="sdcReload" title="最新にする">↻</button>' +
        '<button class="sdc-hbtn" id="sdcClose" title="閉じる">×</button>' +
      '</div>' +
      '<div class="sdc-err" id="sdcErr"></div>' +
      '<div class="sdc-body" id="sdcBody"></div>' +
      '<div class="sdc-foot" id="sdcFoot" style="display:none">' +
        (cfg.side === 'honbu' ? '<div class="sdc-namebar">送信者名<input id="sdcName" type="text" maxlength="20" placeholder="例）本部 木村"></div>' : '') +
        '<div class="sdc-comp"><textarea id="sdcText" rows="1" placeholder="メッセージを入力"></textarea><button class="sdc-send" id="sdcSend" disabled>送信</button></div>' +
        '<div class="sdc-hint">Ctrl＋Enter で送信（Enterだけなら改行）</div>' +
      '</div>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);
    if (cfg.showFab === false) panel.style.bottom = '22px';

    $('sdcClose').onclick = close;
    $('sdcBack').onclick = function () { state.room = null; renderList(); loadSummary(); };
    $('sdcReload').onclick = function () { state.room ? loadRoom(true) : loadSummary(); };
    var ta = $('sdcText');
    ta.addEventListener('input', function () { autosize(); updateSendBtn(); });
    ta.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
    });
    $('sdcSend').onclick = send;
    var nm = $('sdcName');
    if (nm) {
      nm.value = honbuName();
      nm.addEventListener('input', function () { try { localStorage.setItem(NAME_KEY, nm.value.trim()); } catch (e) {} updateSendBtn(); });
    }
  }

  function autosize() { var ta = $('sdcText'); ta.style.height = '42px'; ta.style.height = Math.max(42, Math.min(ta.scrollHeight + 2, 140)) + 'px'; }
  function updateSendBtn() {
    var ok = !!$('sdcText').value.trim() && !state.sending;
    if (cfg.side === 'honbu' && $('sdcName') && !$('sdcName').value.trim()) ok = false;
    $('sdcSend').disabled = !ok;
  }
  function showErr(msg) { var e = $('sdcErr'); e.textContent = msg || ''; e.classList.toggle('show', !!msg); }

  /* ---------- 未読の数 ---------- */
  function setBadges(total) {
    state.total = total;
    var b = $('sdcFabBadge');
    if (b) { b.textContent = total > 99 ? '99+' : total; b.hidden = !total; }
    (cfg.badgeIds || []).forEach(function (id) {
      var el = $(id); if (!el) return;
      el.textContent = total > 99 ? '99+' : (total || '');
      el.style.display = total ? '' : 'none';
    });
    if (typeof cfg.onUnread === 'function') { try { cfg.onUnread(total); } catch (e) {} }
  }

  function loadSummary() {
    var p = { action: 'summary', side: cfg.side };
    if (cfg.side === 'garden') p.garden = cfg.garden.code;
    return apiGet(p).then(function (d) {
      state.rooms = {};
      (d.rooms || []).forEach(function (r) { state.rooms[r.garden] = r; });
      setBadges(cfg.side === 'honbu' && cfg.fixedGarden ? ((state.rooms[cfg.fixedGarden] || {}).unread || 0) : (d.total || 0));
      if (state.open && !state.room) renderList();
      showErr('');
    }).catch(function (e) { if (state.open) showErr('つながりませんでした：' + e.message); });
  }

  /* ---------- 本部側：園の一覧 ---------- */
  function renderList() {
    $('sdcTitle').textContent = '園長とのチャット';
    $('sdcBack').style.display = 'none';
    $('sdcFoot').style.display = 'none';
    var list = gardens().map(function (g) {
      var r = state.rooms[g.code] || { unread: 0, lastAt: 0, lastText: '' };
      return { code: g.code, name: g.name, unread: r.unread, lastAt: r.lastAt, lastText: r.lastText, lastSide: r.lastSide, lastName: r.lastName };
    });
    Object.keys(state.rooms).forEach(function (code) {   // 園マスタにない園コード（念のため）
      if (!list.some(function (x) { return x.code === code; })) { var r = state.rooms[code]; list.push({ code: code, name: code, unread: r.unread, lastAt: r.lastAt, lastText: r.lastText, lastSide: r.lastSide, lastName: r.lastName }); }
    });
    var active = list.filter(function (x) { return x.lastAt; }).sort(function (a, b) { return (b.unread > 0) - (a.unread > 0) || b.lastAt - a.lastAt; });
    var quiet = list.filter(function (x) { return !x.lastAt; });
    var row = function (x) {
      var pv = x.lastText ? ((x.lastSide === 'honbu' ? '本部：' : '') + x.lastText) : 'まだメッセージはありません';
      return '<div class="sdc-room' + (x.unread ? ' has-unread' : '') + '" data-code="' + esc(x.code) + '">' +
        '<div class="mt"><div class="nm">' + esc(x.name) + '</div><div class="pv">' + esc(pv) + '</div></div>' +
        '<div class="rt">' + esc(fmtList(x.lastAt)) + (x.unread ? '<br><span class="ub">' + x.unread + '</span>' : '') + '</div></div>';
    };
    var html = '';
    if (active.length) html += '<div class="sdc-sec">やりとりのある園</div>' + active.map(row).join('');
    if (quiet.length) html += '<div class="sdc-sec">' + (active.length ? 'そのほかの園' : '園を選んでください') + '</div>' + quiet.map(row).join('');
    if (!html) html = '<div class="sdc-empty">園の一覧を読み込み中…</div>';
    var body = $('sdcBody');
    body.innerHTML = html;
    Array.prototype.forEach.call(body.querySelectorAll('.sdc-room'), function (el) {
      el.onclick = function () { openRoom(el.getAttribute('data-code')); };
    });
  }

  /* ---------- 部屋 ---------- */
  function openRoom(code) {
    state.room = code; state.msgs = []; state.lastRoomSig = '';
    var canBack = cfg.side === 'honbu' && !cfg.fixedGarden;
    $('sdcBack').style.display = canBack ? '' : 'none';
    $('sdcTitle').textContent = cfg.side === 'honbu' ? gardenName(code) : '本部とのチャット';
    $('sdcFoot').style.display = '';
    $('sdcBody').innerHTML = '<div class="sdc-empty">読み込み中…</div>';
    updateSendBtn();
    loadRoom(true);
    setTimeout(function () { $('sdcText').focus(); }, 50);
  }

  function loadRoom(force) {
    var code = state.room;
    if (!code) return Promise.resolve();
    return apiGet({ action: 'messages', garden: code, side: cfg.side }).then(function (d) {
      if (state.room !== code) return;
      applyRoom(d, force);
      showErr('');
    }).catch(function (e) { showErr('つながりませんでした：' + e.message); });
  }

  function applyRoom(d, force) {
    state.msgs = d.messages || [];
    state.otherRead = d.otherRead || 0;
    var sig = state.msgs.length + ':' + (state.msgs.length ? state.msgs[state.msgs.length - 1].id : '') + ':' + state.otherRead;
    if (!force && sig === state.lastRoomSig) return;
    state.lastRoomSig = sig;
    renderRoom();
    // 相手からの未読があれば既読にする
    var myRead = d.myRead || 0;
    var hasNew = state.msgs.some(function (m) { return m.side !== cfg.side && m.ts > myRead; });
    if (hasNew && state.open && document.visibilityState === 'visible') {
      apiPost({ action: 'read', garden: state.room, side: cfg.side }).then(loadSummary).catch(function () {});
    }
  }

  function renderRoom() {
    var body = $('sdcBody');
    var nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    if (!state.msgs.length) {
      body.innerHTML = '<div class="sdc-empty">' + (cfg.side === 'honbu'
        ? esc(gardenName(state.room)) + 'の園長・事務の方とのやりとりです。<br>まだメッセージはありません。'
        : '本部とのやりとりです。<br>ほかの園からは見えません。<br>まだメッセージはありません。') + '</div>';
      return;
    }
    var u = user(), lastDay = '', html = '<div class="sdc-msgs">';
    state.msgs.forEach(function (m) {
      var day = fmtDay(m.ts);
      if (day !== lastDay) { html += '<div class="sdc-day"><span>' + esc(day) + '</span></div>'; lastDay = day; }
      var mine = m.side === cfg.side;                 // 自分の側（園側／本部側）が送ったもの
      var right = m.side === 'honbu';                 // 2026-10-14：本部の話は、園長・本部どちらの画面でも右に出す
      var canDel = mine && m.loginId === u.loginId;
      // 送り主の表示：本部側＝「本部・名前」／園側＝「短い園名・名前」（例：八潮駅北・山田）（園側で名前が「本部」のときは園名だけ）
      var who = m.side === 'honbu'
        ? (/本部/.test(m.name || '') ? m.name : '本部' + (m.name ? '・' + m.name : ''))
        : shortName(m.gardenName || gardenName(m.garden)) + (m.name && !/本部/.test(m.name) ? '・' + m.name : '');
      html += '<div class="sdc-m' + (right ? ' mine' : '') + '">' +
        '<div class="who">' + esc(who) + '</div>' +
        '<div class="row"><div class="bub">' + esc(m.text) + '</div>' +
        '<div class="meta">' + (mine && state.otherRead >= m.ts ? '<span>既読</span>' : '') + '<span>' + fmtTime(m.ts) + '</span>' +
        (canDel ? '<button class="sdc-del" data-id="' + esc(m.id) + '">削除</button>' : '') + '</div></div></div>';
    });
    html += '</div>';
    body.innerHTML = html;
    Array.prototype.forEach.call(body.querySelectorAll('.sdc-del'), function (b) {
      b.onclick = function () { removeMsg(b.getAttribute('data-id')); };
    });
    if (nearBottom || !state._scrolledOnce || state._forceBottom) { body.scrollTop = body.scrollHeight; state._scrolledOnce = true; state._forceBottom = false; }
  }

  function send() {
    var ta = $('sdcText'), text = ta.value.trim();
    if (!text || state.sending || !state.room) return;
    var u = user();
    var name = cfg.side === 'honbu' ? (($('sdcName') && $('sdcName').value.trim()) || '') : u.name;
    if (cfg.side === 'honbu' && !name) { showErr('送信者名を入れてください'); return; }
    state.sending = true; updateSendBtn();
    apiPost({
      action: 'send', garden: state.room, gardenName: gardenName(state.room), side: cfg.side,
      loginId: u.loginId, name: name, text: text
    }).then(function (d) {
      ta.value = ''; autosize();
      state._forceBottom = true;
      applyRoom(d, true);
      loadSummary();
      showErr('');
    }).catch(function (e) { showErr('送れませんでした：' + e.message); })
      .then(function () { state.sending = false; updateSendBtn(); });
  }

  function removeMsg(id) {
    if (!confirm('このメッセージを削除しますか？')) return;
    var u = user();
    apiPost({ action: 'delete', id: id, side: cfg.side, loginId: u.loginId })
      .then(function (d) { applyRoom(d, true); loadSummary(); })
      .catch(function (e) { showErr('削除できませんでした：' + e.message); });
  }

  /* ---------- 開く・閉じる ---------- */
  function open(code) {
    if (!cfg) return;
    state.open = true;
    $('sdcPanel').classList.add('show');
    state._scrolledOnce = false;
    var target = code || cfg.fixedGarden || (cfg.side === 'garden' ? cfg.garden.code : (state.room || cfg.defaultGarden || null));
    if (cfg.side === 'honbu' && !code && !cfg.fixedGarden && !cfg.defaultGarden && !state.room) target = null;
    if (target) openRoom(target);
    else { state.room = null; renderList(); loadSummary(); }
  }
  function close() {
    state.open = false;
    $('sdcPanel').classList.remove('show');
  }

  /* ---------- 定期更新（画面が見えているときだけ） ---------- */
  function startPolling() {
    state.timers.push(setInterval(function () { if (document.visibilityState === 'visible') loadSummary(); }, POLL_SUMMARY_MS));
    state.timers.push(setInterval(function () { if (state.open && state.room && document.visibilityState === 'visible') loadRoom(false); }, POLL_ROOM_MS));
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { loadSummary(); if (state.open && state.room) loadRoom(false); }
    });
  }

  function ensureGardens(cb) {
    if (gardens().length) return cb();
    var s = document.createElement('script');
    s.src = 'https://kimkat01.github.io/staff-dashboard/gardens.js';
    s.onload = cb; s.onerror = cb;
    document.head.appendChild(s);
  }

  /* ---------- 公開する関数 ----------
     ShiodomeChat.init({
       side: 'garden' | 'honbu',
       garden: {code, name},        // 園側：自分の園
       fixedGarden: 'S10',          // 本部側で、この園の部屋だけを開く（省略可）
       defaultGarden: 'S10',        // 本部側で、最初に開く園（省略可）
       user: function(){ return {loginId, name}; },
       accent: '#3a63d8',           // ボタン・自分の吹き出しの色
       badgeIds: ['menuBadgeId'],   // 未読数を一緒に出す要素のid（省略可）
       showFab: true,               // 右下の💬ボタンを出すか（false＝メニューやカードから ShiodomeChat.open() で開く）
       onUnread: function(n){}      // 未読数が変わるたびに呼ばれる（省略可）
     })
     ShiodomeChat.open()            // メニューなどから開くとき
  */
  window.ShiodomeChat = {
    enabled: !!CHAT_GAS_URL,
    init: function (options) {
      if (!CHAT_GAS_URL || cfg) return false;
      cfg = options || {};
      if (cfg.side === 'garden' && !(cfg.garden && cfg.garden.code)) { cfg = null; return false; }
      var go = function () {
        injectCss(); build();
        loadSummary(); startPolling();
      };
      if (document.body) ensureGardens(go);
      else document.addEventListener('DOMContentLoaded', function () { ensureGardens(go); });
      return true;
    },
    open: function (code) { open(code); },
    close: close,
    _setUrlForTest: function (u) { CHAT_GAS_URL = u; this.enabled = !!u; }
  };
})();
