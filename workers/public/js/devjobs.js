/* DuoStage AI — dev job control (stands in for vendor callbacks) */
(function () {
  "use strict";
  function t(key) { return window.DS ? DS.t(key) : key; }

  function render(jobs) {
    var list = document.getElementById("djList");
    var empty = document.getElementById("djEmpty");
    if (!list) return;
    list.innerHTML = "";
    if (!jobs.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    jobs.forEach(function (x) {
      var open = x.status === "pending" || x.status === "running";
      var item = document.createElement("div");
      item.className = "inbox-item";
      item.innerHTML =
        '<div class="inbox-meta"><strong></strong><span class="fine"></span>' +
        '<span class="inbox-state ' + (open ? "valid" : x.status === "succeeded" ? "used" : "expired") + '"></span></div>' +
        '<div class="job-actions"></div>';
      item.querySelector("strong").textContent = x.email + " · " + x.model;
      item.querySelector(".fine").textContent = x.id.slice(0, 14) + " · " + x.cost + " credits · " + new Date(x.created).toLocaleTimeString();
      item.querySelector(".inbox-state").textContent = x.status;
      var act = item.querySelector(".job-actions");
      if (open) {
        ["success", "failed", "rejected"].forEach(function (outcome) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "btn btn-outline btn-sm";
          b.setAttribute("data-i18n", outcome === "success" ? "dj.ok" : outcome === "failed" ? "dj.fail" : "dj.reject");
          b.addEventListener("click", function () {
            fetch("/api/dev/jobs/finish", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ jobId: x.id, outcome: outcome }),
            }).then(function () { load(); });
          });
          act.appendChild(b);
        });
      }
      list.appendChild(item);
    });
    if (window.DS) DS.applyLang(DS.getLang());
  }

  function load() {
    fetch("/api/dev/jobs").then(function (r) { return r.json(); }).then(function (j) {
      render(j.ok ? j.jobs : []);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    Auth.ensure().then(load);
  });
})();
