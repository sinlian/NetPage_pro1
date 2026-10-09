/* DuoStage AI — login page logic (magic link + Google placeholder) */
(function () {
  "use strict";
  function t(key) { return window.DS ? DS.t(key) : key; }

  var toastEl = document.getElementById("toast");
  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("emailForm");
    var emailInput = document.getElementById("emailInput");
    var msg = document.getElementById("loginMsg");
    var sentBox = document.getElementById("sentBox");
    var googleBtn = document.getElementById("googleBtn");

    function showMsg(text, cls) {
      if (!msg) return;
      msg.textContent = text;
      msg.className = "login-msg " + (cls || "");
      msg.hidden = false;
    }

    /* 1) arriving with ?token=... means the magic link was clicked */
    var params = new URLSearchParams(location.search);
    var token = params.get("token");
    if (token) {
      Auth.ensure().then(function () {
        return Auth.consumeMagicLink(token);
      }).then(function (res) {
        if (res.ok) {
          showMsg(t("login.welcome").replace("{email}", res.session.email), "ok");
          Auth.renderHeaderAuth();
          setTimeout(function () { location.href = "index.html"; }, 900);
        } else {
          showMsg(t(res.error === "expired" ? "login.expired" : "login.invalid"), "err");
        }
      });
    }

    /* 2) email magic link request */
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        Auth.ensure().then(function () {
          return Auth.requestMagicLink(emailInput.value);
        }).then(function (r) {
          if (!r.ok) { showMsg(t("login.badEmail"), "err"); return; }
          msg.hidden = true;
          form.hidden = true;
          if (sentBox) sentBox.hidden = false;
        });
      });
    }
    var againBtn = document.getElementById("againBtn");
    if (againBtn) {
      againBtn.addEventListener("click", function () {
        if (sentBox) sentBox.hidden = true;
        if (form) { form.hidden = false; emailInput.value = ""; emailInput.focus(); }
      });
    }

    /* 3) Google — real OAuth pending; demo adapter in local mode */
    if (googleBtn) {
      googleBtn.addEventListener("click", function () {
        Auth.ensure().then(function () {
          return Auth.signInGoogleDemo();
        }).then(function (res) {
          if (!res.ok) { showMsg(t("login.googlePending"), "err"); return; }
          Auth.renderHeaderAuth();
          if (Auth.mode() === "local") toast(t("login.googleDemo"));
          setTimeout(function () { location.href = "index.html"; }, 900);
        });
      });
    }
  });
})();
