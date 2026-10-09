/* DuoStage AI — dev checkout page (simulated gateway hosted page) */
(function () {
  "use strict";
  function t(key) { return window.DS ? DS.t(key) : key; }

  document.addEventListener("DOMContentLoaded", function () {
    var orderId = new URLSearchParams(location.search).get("order");
    var msg = document.getElementById("coMsg");
    var actions = document.getElementById("coActions");
    var packNames = { single: "pr.n1", starter: "pr.n2", creator: "pr.n3", studio: "pr.n4" };
    var statusKeys = { pending: "co.st.pending", paid: "co.st.paid", cancelled: "co.st.cancelled" };

    function showMsg(key, cls) {
      msg.textContent = t(key);
      msg.className = "login-msg " + cls;
      msg.hidden = false;
    }
    function setStatus(status) {
      var el = document.getElementById("coStatus");
      if (el) el.textContent = t(statusKeys[status] || status);
    }

    if (!orderId) { showMsg("co.unknown", "err"); actions.hidden = true; return; }

    fetch("/api/dev/order?id=" + encodeURIComponent(orderId))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { showMsg("co.unknown", "err"); actions.hidden = true; return; }
        var o = j.order;
        document.getElementById("coPack").textContent = t(packNames[o.pack] || o.pack);
        document.getElementById("coPrice").textContent = "$" + o.usd.toFixed(2);
        document.getElementById("coCredits").textContent = o.credits.toLocaleString("en-US");
        setStatus(o.status);
        if (o.status !== "pending") { actions.hidden = true; showMsg(o.status === "paid" ? "co.done" : "co.cancelled", o.status === "paid" ? "ok" : "err"); }
      })
      .catch(function () { showMsg("co.unknown", "err"); actions.hidden = true; });

    function confirm(outcome, thenKey, cls, redirect) {
      fetch("/api/pay/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: orderId, outcome: outcome }),
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) { showMsg("co.unknown", "err"); return; }
          setStatus(j.status);
          actions.hidden = true;
          showMsg(thenKey, cls);
          setTimeout(function () { location.href = redirect; }, 1100);
        });
    }

    document.getElementById("payBtn").addEventListener("click", function () {
      confirm("success", "co.done", "ok", "account.html");
    });
    document.getElementById("cancelBtn").addEventListener("click", function () {
      confirm("cancel", "co.cancelled", "err", "index.html#pricing");
    });

    if (window.DS) DS.onLangChange(function () {
      var o = document.getElementById("coPack").textContent;
      /* re-translate pack & status cells */
      Object.keys(packNames).forEach(function (k) {
        if (o === t(packNames[k]) || o === k) document.getElementById("coPack").textContent = t(packNames[k]);
      });
    });
  });
})();
