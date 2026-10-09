/* DuoStage AI — index page interactions
   i18n lives in js/i18n.js (window.DS); auth in js/auth.js (window.Auth). */
(function () {
  "use strict";

  function t(key) { return window.DS ? DS.t(key) : key; }

  /* ---------- toast ---------- */
  var toastEl = document.getElementById("toast");
  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  /* ---------- mobile nav ---------- */
  var navToggle = document.getElementById("navToggle");
  var nav = document.getElementById("siteNav");
  if (navToggle && nav) {
    navToggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") nav.classList.remove("open");
    });
  }

  /* ---------- segmented controls + cost ---------- */
  var state = { duration: 15, quality: "768", frame: "9:16", model: "aurora" };
  var PRICE = null; /* live config from /api/pricing; null = offline fallback */
  var MODEL_NAMES = { aurora: "Aurora H3", flow: "FlowFrame 2.5", omni: "OmniTake 3.0" };
  var lastCost = 240;

  function costFor(model, quality, duration) {
    if (PRICE && PRICE.creditTable && PRICE.creditTable[model]) {
      var q = PRICE.creditTable[model][quality === "2k" ? "2k" : "768"];
      if (q && q[duration]) return q[duration];
    }
    var c = duration * 16; /* offline fallback, mirrors old demo math */
    return quality === "2k" ? c * 2 : c;
  }

  function refreshCost() {
    var credits = costFor(state.model, state.quality, state.duration);
    lastCost = credits;
    var costEl = document.getElementById("costValue");
    var sumEl = document.getElementById("settingSummary");
    if (costEl) costEl.textContent = credits.toLocaleString("en-US") + " " + t("up.credits");
    if (sumEl) {
      var q = state.quality === "2k" ? "2K" : "768P";
      sumEl.textContent = state.duration + "s · " + q + " · " + state.frame;
    }
  }

  function loadPricing() {
    fetch("/api/pricing", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("pricing")); })
      .then(function (j) {
        if (j && j.ok) { PRICE = j; refreshCost(); renderCreditTable(); }
      })
      .catch(function () { /* local mode: keep fallback math */ });
  }

  function renderCreditTable() {
    var wrap = document.getElementById("creditTable");
    if (!wrap || !PRICE || !PRICE.creditTable) return;
    var rows = "";
    Object.keys(PRICE.creditTable).forEach(function (m) {
      var t768 = PRICE.creditTable[m]["768"] || {};
      var t2k = PRICE.creditTable[m]["2k"] || {};
      rows += "<tr><th>" + (MODEL_NAMES[m] || m) + "</th><td>768P</td><td>" + t768[5] + "</td><td>" + t768[10] + "</td><td>" + t768[15] + "</td></tr>";
      rows += '<tr><th></th><td>2K</td><td>' + t2k[5] + "</td><td>" + t2k[10] + "</td><td>" + t2k[15] + "</td></tr>";
    });
    wrap.innerHTML =
      '<table class="credit-table"><thead><tr><th>' + t("price.tableModel") +
      "</th><th></th><th>5s</th><th>10s</th><th>15s</th></tr></thead><tbody>" + rows + "</tbody></table>";
    wrap.hidden = false;
  }

  document.querySelectorAll(".seg").forEach(function (seg) {
    var group = seg.getAttribute("data-group");
    seg.addEventListener("click", function (e) {
      var btn = e.target.closest(".seg-btn");
      if (!btn) return;
      seg.querySelectorAll(".seg-btn").forEach(function (b) { b.classList.remove("is-on"); });
      btn.classList.add("is-on");
      var raw = btn.getAttribute("data-value");
      state[group] = group === "duration" ? parseInt(raw, 10) : raw;
      refreshCost();
    });
  });

  /* ---------- photo dropzones (presign + direct PUT in http mode) ---------- */
  var slotData = { 1: null, 2: null }; /* {preview, key} */
  var generateBtn = document.getElementById("generateBtn");
  /* dev/test hooks (remove in production):
     ?devgate=1 keeps generate enabled without photos (gate E2E)
     ?devphotos=1 fabricates two tiny uploads through the real presign+PUT path */
  var DEVGATE = new URLSearchParams(location.search).has("devgate");
  var DEVPHOTOS = new URLSearchParams(location.search).has("devphotos");

  function syncGenerate() {
    if (!generateBtn) return;
    var ready = !!(slotData[1] && slotData[2]);
    if (window.Auth && Auth.mode() === "http") ready = !!(slotData[1] && slotData[1].key && slotData[2] && slotData[2].key);
    generateBtn.disabled = DEVGATE ? false : !ready;
    generateBtn.textContent = ready ? t("up.genReady") : t("up.genCta");
  }

  function uploadFile(slot, file) {
    var previewUrl = URL.createObjectURL(file);
    if (!window.Auth || Auth.mode() !== "http") {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function (ev) { resolve({ preview: ev.target.result, key: null }); };
        reader.onerror = function () { reject("up.uploadFail"); };
        reader.readAsDataURL(file);
      });
    }
    return Auth.presign({ slot: slot, mime: file.type, size: file.size }).then(function (p) {
      if (!p.ok) throw p.error === "bad-type" ? "up.badType" : p.error === "bad-size" ? "t.over" : "up.uploadFail";
      return fetch(p.putUrl, { method: "PUT", headers: { "content-type": file.type }, body: file })
        .then(function (r) { return r.json(); })
        .then(function (j2) {
          if (!j2.ok) throw "up.uploadFail";
          return { preview: previewUrl, key: j2.key };
        });
    });
  }

  document.querySelectorAll(".dz input[type=file]").forEach(function (input) {
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (["image/jpeg", "image/png", "image/webp"].indexOf(file.type) < 0) {
        toast(t("up.badType")); input.value = ""; return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast(t("t.over")); input.value = ""; return;
      }
      var slot = input.getAttribute("data-slot");
      uploadFile(slot, file).then(function (d) {
        slotData[slot] = d;
        paint();
        syncGenerate();
      }).catch(function (key) {
        toast(t(key));
        input.value = "";
      });
    });
  });

  function paint() {
    [1, 2].forEach(function (n) {
      var dz = document.getElementById("dz" + n);
      if (!dz) return;
      var img = dz.querySelector(".dz-preview");
      var d = slotData[n];
      if (d && d.preview) {
        img.src = d.preview;
        dz.classList.add("has-image");
      } else {
        img.removeAttribute("src");
        dz.classList.remove("has-image");
      }
    });
  }

  var swapBtn = document.getElementById("swapBtn");
  if (swapBtn) {
    swapBtn.addEventListener("click", function () {
      var tmp = slotData[1]; slotData[1] = slotData[2]; slotData[2] = tmp;
      paint();
      toast(t("t.swapped"));
    });
  }

  /* ---------- jobs: create + poll + render list ---------- */
  var jobPollTimer = null;

  function switchToMine() {
    var tab = document.querySelector('.tab[data-tab="mine"]');
    if (tab) tab.click();
  }

  function refreshJobs(auto) {
    if (!window.Auth || Auth.mode() !== "http") return;
    Auth.jobs().then(function (list) {
      renderJobList(list);
      var active = list.some(function (x) { return x.status === "pending" || x.status === "running"; });
      clearTimeout(jobPollTimer);
      if (active && auto !== false) jobPollTimer = setTimeout(function () { refreshJobs(true); }, 2000);
    });
  }

  function renderJobList(list) {
    var wrap = document.getElementById("jobList");
    var empty = document.getElementById("mineEmpty");
    if (!wrap) return;
    if (!list || !list.length) {
      if (empty) empty.hidden = false;
      wrap.innerHTML = "";
      return;
    }
    if (empty) empty.hidden = true;
    wrap.innerHTML = "";
    list.slice(0, 8).forEach(function (x) {
      var stKey = x.status === "succeeded" ? "job.succeeded"
        : x.status === "failed" ? (x.error_code === "moderation" ? "job.rejected" : "job.failed")
        : x.status === "running" ? "job.running" : "job.pending";
      var stCls = x.status === "succeeded" ? "ok" : x.status === "failed" ? "bad" : "wait";
      var div = document.createElement("div");
      div.className = "job-item";
      div.innerHTML =
        '<div class="job-meta"><span class="job-state ' + stCls + '" data-i18n="' + stKey + '"></span>' +
        '<span class="fine job-spec"></span></div>' +
        '<div class="job-actions"></div>';
      div.querySelector(".job-spec").textContent =
        (MODEL_NAMES[x.model] || x.model) + " · " + x.duration_s + "s · " +
        (x.quality === "2k" ? "2K" : "768P") + " · " + x.aspect + " · " + x.cost + " " + t("up.credits");
      var act = div.querySelector(".job-actions");
      if (x.status === "succeeded" && x.render) {
        act.innerHTML =
          '<a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="' + x.render.output_url + '" data-i18n="rv.watch"></a>' +
          '<a class="btn btn-outline btn-sm" href="' + x.render.output_url + '" download data-i18n="rv.download"></a>';
      }
      wrap.appendChild(div);
    });
    if (window.DS) DS.applyLang(DS.getLang());
  }

  function createJobAndWatch() {
    var p1 = slotData[1] && slotData[1].key;
    var p2 = slotData[2] && slotData[2].key;
    if (!p1 || !p2) { toast(t("up.genCta")); return; }
    return Auth.createJob({
      model: state.model, duration: state.duration, quality: state.quality,
      aspect: state.frame, photo1: p1, photo2: p2,
    }).then(function (jres) {
      if (!jres.ok) {
        toast(t(jres.error === "insufficient" ? "gate.needCredits"
          : jres.error === "too-many-active" ? "job.tooMany" : "job.createFail"));
        return;
      }
      toast(t("job.created"));
      switchToMine();
      refreshJobs(true);
    });
  }

  if (generateBtn) {
    generateBtn.addEventListener("click", function () {
      /* gating: auth -> balance -> create job */
      if (!window.Auth) { toast(t("t.demo")); return; }
      Auth.ensure().then(function () {
        var user = Auth.currentUser();
        if (!user) { location.href = "login.html"; return; }
        if (Auth.mode() !== "http") { toast(t("t.demo")); return; }
        return Auth.credits().then(function (c) {
          if (c.balance - c.reserved < lastCost) {
            toast(t("gate.needCredits"));
            var pr = document.getElementById("pricing");
            if (pr) pr.scrollIntoView({ behavior: "smooth" });
            return;
          }
          return createJobAndWatch();
        });
      });
    });
  }

  /* dev hook: fabricate two uploads through the real presign+PUT path */
  if (DEVPHOTOS && window.Auth) {
    Auth.ensure().then(function () {
      if (Auth.mode() !== "http") return;
      var PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      return fetch(PNG).then(function (r) { return r.blob(); }).then(function (blob) {
        return Promise.all([
          uploadFile(1, new File([blob], "dev-left.png", { type: "image/png" })),
          uploadFile(2, new File([blob], "dev-right.png", { type: "image/png" })),
        ]);
      }).then(function (ds) {
        slotData[1] = ds[0];
        slotData[2] = ds[1];
        paint();
        syncGenerate();
      });
    });
  }

  /* ---------- preview tabs ---------- */
  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (t2) { t2.classList.remove("is-on"); });
      tab.classList.add("is-on");
      var which = tab.getAttribute("data-tab");
      document.querySelectorAll("[data-pane]").forEach(function (pane) {
        pane.hidden = pane.getAttribute("data-pane") !== which;
      });
      if (which === "mine") refreshJobs(true);
    });
  });

  var playBtn = document.querySelector(".play-btn");
  if (playBtn) {
    playBtn.addEventListener("click", function () {
      toast(t("t.play"));
    });
  }

  /* ---------- FAQ accordion ---------- */
  document.querySelectorAll(".faq-item").forEach(function (item) {
    var q = item.querySelector(".faq-q");
    var a = item.querySelector(".faq-a");
    if (!q || !a) return;
    q.addEventListener("click", function () {
      var isOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach(function (other) {
        if (other !== item) {
          other.classList.remove("open");
          other.querySelector(".faq-q").setAttribute("aria-expanded", "false");
          other.querySelector(".faq-a").style.maxHeight = "0px";
        }
      });
      item.classList.toggle("open", !isOpen);
      q.setAttribute("aria-expanded", isOpen ? "false" : "true");
      a.style.maxHeight = isOpen ? "0px" : a.scrollHeight + "px";
    });
  });

  /* ---------- pricing pack buttons: start checkout ---------- */
  document.querySelectorAll("[data-pack]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var pack = btn.getAttribute("data-pack");
      if (!window.Auth) { toast(t("t.demo")); return; }
      Auth.ensure().then(function () {
        if (!Auth.currentUser()) { location.href = "login.html"; return; }
        if (Auth.mode() !== "http") { toast(t("t.demo")); return; }
        return Auth.checkout(pack).then(function (j) {
          if (j.ok && j.checkoutUrl) location.href = j.checkoutUrl;
          else toast(t("gate.needLoginToast"));
        });
      });
    });
  });

  /* ---------- pricing / cta anchors that need a nudge ---------- */
  document.querySelectorAll('a[href="#create"]').forEach(function (a) {
    a.addEventListener("click", function () {
      setTimeout(function () {
        var card = document.querySelector(".upload-card");
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
    });
  });

  /* ---------- keep JS-driven strings in sync with language ---------- */
  if (window.DS) {
    DS.onLangChange(function () {
      refreshCost();
      syncGenerate();
      renderCreditTable();
      document.querySelectorAll(".faq-item.open .faq-a").forEach(function (a) {
        a.style.maxHeight = a.scrollHeight + "px";
      });
    });
  }

  refreshCost();
  syncGenerate();
  loadPricing();
})();
