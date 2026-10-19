/* ============================================================
   ポータルへ戻る「ログアウト」ボタン（2026-10-19）
   ・しおどめポータルサイト（園長ダッシュボード）の左メニューから開いたツールに、
     画面左下へ「ログアウト」ボタンを出す。押すと、しおどめポータルサイトに戻る。
   ・各ツールの </body> の直前に1行入れるだけで使える：
       <script src="https://kimkat01.github.io/shiodome-knowledge/portal-back.js"></script>
   ・ポータルから開いたときだけ表示する（職員ダッシュボードなど別の入口から開いたときは出ない）
     判定：①開いた元のページがポータル ②ポータルが直前（60秒以内）に残した引き継ぎメモ
     一度判定できれば、そのタブの中で別のページへ移っても表示し続ける
   ・押したとき：ツールが新しいタブで開いている場合はタブを閉じて元のポータルに戻る。
     閉じられない場合は、このタブでポータルを開き直す
   ============================================================ */
(function () {
  var KEY = 'portal_back_url';
  var HANDOFF = 'portal_back_handoff';
  var PORTAL_RE = /^https:\/\/kimkat01\.github\.io\/shiodome-knowledge\/(index\.html)?(\?[^#]*)?(#.*)?$/;

  function store(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }

  // ポータルが残した引き継ぎメモは、どのページで読んでも1回で消す（別の入口から開いたページに残らないように）
  var memo = '';
  try {
    var h = JSON.parse(localStorage.getItem(HANDOFF) || 'null');
    if (h && h.url && PORTAL_RE.test(h.url) && Date.now() - h.at < 60000) memo = h.url;
    if (h) localStorage.removeItem(HANDOFF);
  } catch (e) {}

  var url = load(KEY);
  if (!url) {
    var ref = document.referrer || '';
    if (PORTAL_RE.test(ref)) url = ref;
  }
  if (!url) url = memo;
  if (!url) return;            // ポータル以外から開かれた
  store(KEY, url);

  function build() {
    if (document.getElementById('portalBackBtn')) return;
    var css = document.createElement('style');
    css.textContent =
      '#portalBackBtn{position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:2147483000;' +
      'display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:999px;border:1px solid #d4d0e8;' +
      'background:#fff;color:#3b3560;font:700 14px/1 "Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo",sans-serif;' +
      'box-shadow:0 4px 14px rgba(40,30,90,.18);cursor:pointer;text-decoration:none}' +
      '#portalBackBtn:hover{background:#f3f1fb}' +
      '#portalBackBtn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
      '@media print{#portalBackBtn{display:none!important}}';
    document.head.appendChild(css);

    var a = document.createElement('a');
    a.id = 'portalBackBtn';
    a.href = url;
    a.title = 'しおどめポータルサイトに戻る';
    a.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l-5-5 5-5"/><path d="M11 12h10"/></svg>ログアウト';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      // 新しいタブで開いたツールなら、タブを閉じて元のポータルのタブに戻る
      if (history.length <= 1) {
        try { window.close(); } catch (err) {}
      }
      // 閉じられなかったときは、このタブでポータルを開く
      setTimeout(function () { location.href = url; }, 250);
    });
    document.body.appendChild(a);
  }
  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
