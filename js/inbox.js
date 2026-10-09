/* DuoStage AI — dev inbox (demo-only magic link mailbox) */
(function () {
  "use strict";

  function render(items) {
    var list = document.getElementById("inboxList");
    var empty = document.getElementById("inboxEmpty");
    if (!list) return;
    list.innerHTML = "";
    if (!items.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    items.forEach(function (l) {
      var stateKey = l.used ? "inbox.used" : (l.expired ? "inbox.expired" : "inbox.valid");
      var stateCls = l.used ? "used" : (l.expired ? "expired" : "valid");
      var item = document.createElement("div");
      item.className = "inbox-item";
      item.innerHTML =
        '<div class="inbox-meta">' +
          '<strong></strong>' +
          '<span class="inbox-state ' + stateCls + '" data-i18n="' + stateKey + '"></span>' +
          '<span class="fine inbox-time"></span>' +
        '</div>' +
        '<a class="btn btn-outline" href="login.html?token=' + encodeURIComponent(l.id) + '" data-i18n="inbox.open"></a>';
      item.querySelector("strong").textContent = l.email;
      item.querySelector(".inbox-time").textContent =
        new Date(l.created).toLocaleTimeString() + " · id " + String(l.id).slice(0, 8);
      list.appendChild(item);
    });
    if (window.DS) DS.applyLang(DS.getLang()); /* fill data-i18n in new nodes */
  }

  document.addEventListener("DOMContentLoaded", function () {
    Auth.ensure().then(function () {
      return Auth.listMagicLinks();
    }).then(render);
  });
})();
