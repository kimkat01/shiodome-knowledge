// ============================================================
// 施設別リンク自動選択パッチ（既存コードは書き換えません）
// 使い方: index.html の </body> の直前に
//   <script src="facility_patch.js"></script>
// を1行追加するだけでOKです。
//
// URLに ?fac=キー を付けると、garden-select が自動でその園に
// 切り替わり、有給チェッカー等へのリンクも正しい園名になります。
// 例: index.html?fac=misato_chuo#main  → 三郷中央
// ============================================================
(function () {
  function getUrlFacilityKey() {
    try {
      var params = new URLSearchParams(location.search);
      return params.get("fac") || params.get("facility") || "";
    } catch (e) {
      return "";
    }
  }

  function applyFacilitySelection(s) {
    var key = getUrlFacilityKey();
    if (!key) return false;
    var keys = s ? KEYS_S : KEYS_Y;
    var idx = keys.indexOf(key);
    if (idx < 0) return false;
    var sel = document.getElementById("garden-select");
    if (sel && sel.options[idx]) {
      sel.selectedIndex = idx;
      return true;
    }
    return false;
  }

  // 元の goTop を退避して、施設選択の適用ステップだけ追加した版に差し替える
  var _originalGoTop = window.goTop;
  window.goTop = function () {
    _originalGoTop();
    var applied = applyFacilitySelection(law === "s");
    if (applied) {
      // 選択が変わったので、依存しているリンク・チャットURLを再計算
      if (typeof updateUqLink === "function") updateUqLink();
      if (typeof updateDomebotFrame === "function") updateDomebotFrame();
    }
  };
})();
