/* DuoStage AI — account settings page logic */
(function () {
  "use strict";
  function t(key) { return window.DS ? DS.t(key) : key; }

  document.addEventListener("DOMContentLoaded", function () {
    var gate = document.getElementById("needLogin");
    var card = document.getElementById("accountCard");

    Auth.ensure().then(function () {
      var s = Auth.currentUser();
      if (!s) {
        if (gate) gate.hidden = false;
        if (card) card.hidden = true;
        setTimeout(function () { location.href = "login.html"; }, 1200);
        return;
      }
      var set = function (id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
      set("acctEmail", s.email);
      set("acctMethod", t(s.method === "google" ? "acct.methodGoogle" : "acct.methodEmail"));
      set("acctJoined", new Date(s.since || Date.now()).toLocaleDateString());

      /* credits & ledger (http mode only; local demo has no ledger) */
      Auth.credits().then(function (c) {
        set("acctBalance", String(c.balance));
        set("acctReserved", String(c.reserved));
        var list = document.getElementById("ledgerList");
        var empty = document.getElementById("ledgerEmpty");
        if (!list) return;
        if (!c.ledger || !c.ledger.length) { if (empty) empty.hidden = false; return; }
        if (empty) empty.hidden = true;
        list.innerHTML = "";
        c.ledger.forEach(function (e) {
          var li = document.createElement("li");
          var sign = e.delta > 0 ? "+" : (e.delta < 0 ? "−" : "±");
          li.innerHTML =
            '<span class="ledger-reason" data-i18n="ledger.' + e.reason + '"></span>' +
            '<span class="ledger-delta ' + (e.delta > 0 ? "plus" : e.delta < 0 ? "minus" : "zero") + '">' + sign + Math.abs(e.delta) + "</span>" +
            '<time class="fine"></time>';
          li.querySelector("time").textContent = new Date(e.created).toLocaleString();
          list.appendChild(li);
        });
        if (window.DS) DS.applyLang(DS.getLang());
      });

      var out = document.getElementById("signOutBtn");
      if (out) {
        out.addEventListener("click", function () {
          Auth.signOut().then(function () {
            Auth.renderHeaderAuth();
            location.href = "index.html";
          });
        });
      }
      if (window.DS) {
        DS.onLangChange(function () {
          set("acctMethod", t(s.method === "google" ? "acct.methodGoogle" : "acct.methodEmail"));
        });
      }
    });
  });
})();
