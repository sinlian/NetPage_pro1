/* DuoStage AI — my renders library page */
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

  var MODEL_NAMES = { aurora: "Aurora H3", flow: "FlowFrame 2.5", omni: "OmniTake 3.0" };

  function stateKey(x) {
    if (x.status === "succeeded") return "job.succeeded";
    if (x.status === "failed") return x.error_code === "moderation" ? "job.rejected" : "job.failed";
    if (x.status === "running") return "job.running";
    return "job.pending";
  }
  function stateCls(x) {
    return x.status === "succeeded" ? "ok" : x.status === "failed" ? "bad" : "wait";
  }

  function render(jobList, dlByJob) {
    var wrap = document.getElementById("libList");
    var empty = document.getElementById("libEmpty");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!jobList.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    jobList.forEach(function (x) {
      var card = document.createElement("article");
      card.className = "card lib-card";
      var thumb = x.status === "succeeded" && x.render
        ? '<div class="lib-thumb"><svg viewBox="0 0 640 360"><use href="#stageScene"/></svg></div>'
        : '<div class="lib-thumb lib-thumb-empty"><span class="job-state ' + stateCls(x) + '" data-i18n="' + stateKey(x) + '"></span></div>';
      card.innerHTML =
        thumb +
        '<div class="lib-body">' +
          '<div class="lib-meta"><span class="job-state ' + stateCls(x) + '" data-i18n="' + stateKey(x) + '"></span>' +
          '<span class="fine lib-spec"></span></div>' +
          '<div class="lib-actions"></div>' +
        '</div>';
      card.querySelector(".lib-spec").textContent =
        (MODEL_NAMES[x.model] || x.model) + " · " + x.duration_s + "s · " +
        (x.quality === "2k" ? "2K" : "768P") + " · " + x.aspect + " · " + x.cost + " " + t("up.credits") +
        " · " + new Date(x.created).toLocaleString();
      var act = card.querySelector(".lib-actions");
      if (x.status === "succeeded" && x.render) {
        act.innerHTML =
          '<a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="' + x.render.output_url + '" data-i18n="rv.watch"></a>' +
          '<a class="btn btn-primary btn-sm" href="' + (dlByJob[x.id] || x.render.output_url) + '" data-i18n="rv.download"></a>' +
          '<button class="btn btn-quiet btn-sm lib-del" type="button" data-i18n="lib.del"></button>';
        act.querySelector(".lib-del").addEventListener("click", function () {
          if (!window.confirm(t("lib.confirm"))) return;
          Auth.deleteRender(x.render.id).then(function (ok) {
            if (ok) { toast(t("lib.deleted")); load(); }
          });
        });
      }
      wrap.appendChild(card);
    });
    if (window.DS) DS.applyLang(DS.getLang());
  }

  function load() {
    Auth.ensure().then(function () {
      if (!Auth.currentUser()) { location.href = "login.html"; return; }
      return Promise.all([Auth.jobs(), Auth.renders()]).then(function (res) {
        var dlByJob = {};
        (res[1] || []).forEach(function (r) { dlByJob[r.job_id] = r.render.download_url; });
        render(res[0] || [], dlByJob);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", load);
})();
