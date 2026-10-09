/* DuoStage AI — auth module with pluggable adapters
   - http adapter : talks to the real backend skeleton (server/) when reachable
   - local adapter: localStorage demo fallback (file:// or server down)
   Public API (unchanged for callers):
     Auth.ensure() -> Promise<mode>          validate cached session on boot
     Auth.currentUser() -> session|null      synchronous, from cache
     Auth.mode() -> 'http'|'local'|null
     Auth.requestMagicLink(email) -> Promise<{ok, error?}>
     Auth.consumeMagicLink(token) -> Promise<{ok, session?, error?}>
     Auth.signInGoogleDemo() -> Promise<{ok, session?, error?}>
     Auth.signOut() -> Promise
     Auth.listMagicLinks() -> Promise<items>  dev inbox data
     Auth.renderHeaderAuth()                   sync, from cache */
(function () {
  "use strict";

  var TOKEN_KEY = "ds-token";
  var CACHE_KEY = "ds-user-cache";
  /* local-demo tables */
  var LS_USERS = "ds-users";
  var LS_LINKS = "ds-magic-links";
  var LS_SESSION = "ds-session";
  var LINK_TTL = 15 * 60 * 1000;

  var mode = null;
  var ensurePromise = null;
  var userCache = read(CACHE_KEY, null);
  var sessionToken = read(TOKEN_KEY, null);

  function read(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }
  function clear(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  function now() { return Date.now(); }
  function makeToken() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "t-" + Math.random().toString(36).slice(2) + now().toString(36);
  }
  function validEmail(email) { return /^\S+@\S+\.\S+$/.test(email); }

  function setSession(token, user) {
    sessionToken = token; userCache = user;
    if (token) write(TOKEN_KEY, token); else clear(TOKEN_KEY);
    if (user) write(CACHE_KEY, user); else clear(CACHE_KEY);
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "content-type": "application/json" }, opts.headers);
    if (sessionToken) opts.headers["authorization"] = "Bearer " + sessionToken;
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    });
  }

  /* ---------- local (demo) adapter ---------- */
  var local = {
    requestMagicLink: function (email) {
      email = String(email || "").trim().toLowerCase();
      if (!validEmail(email)) return Promise.resolve({ ok: false, error: "bad-email" });
      var links = read(LS_LINKS, []);
      links.unshift({ id: makeToken(), email: email, created: now(), expires: now() + LINK_TTL, used: false });
      write(LS_LINKS, links.slice(0, 20));
      return Promise.resolve({ ok: true });
    },
    consumeMagicLink: function (id) {
      var links = read(LS_LINKS, []);
      var link = null;
      for (var i = 0; i < links.length; i++) if (links[i].id === id) { link = links[i]; break; }
      if (!link || link.used) return Promise.resolve({ ok: false, error: "invalid" });
      if (now() > link.expires) return Promise.resolve({ ok: false, error: "expired" });
      link.used = true; write(LS_LINKS, links);
      var users = read(LS_USERS, {});
      if (!users[link.email]) users[link.email] = { email: link.email, method: "email", created: now() };
      write(LS_USERS, users);
      var session = { email: link.email, method: "email", since: users[link.email].created };
      setSession(null, session);
      return Promise.resolve({ ok: true, session: session });
    },
    signInGoogleDemo: function () {
      var email = "demo.google@duostage.example";
      var users = read(LS_USERS, {});
      if (!users[email]) users[email] = { email: email, method: "google", created: now() };
      write(LS_USERS, users);
      var session = { email: email, method: "google", since: users[email].created };
      setSession(null, session);
      return Promise.resolve({ ok: true, session: session });
    },
    signOut: function () { setSession(null, null); clear(LS_SESSION); return Promise.resolve(); },
    listMagicLinks: function () {
      var links = read(LS_LINKS, []);
      return Promise.resolve(links.map(function (l) {
        return { id: l.id, email: l.email, created: l.created, used: l.used, expired: now() > l.expires };
      }));
    },
  };

  /* ---------- http adapter ---------- */
  var http = {
    requestMagicLink: function (email) {
      return api("/api/auth/magic-link", { method: "POST", body: JSON.stringify({ email: email }) })
        .then(function (r) { return r.body.ok ? { ok: true } : { ok: false, error: r.body.error }; });
    },
    consumeMagicLink: function (token) {
      return api("/api/auth/consume", { method: "POST", body: JSON.stringify({ token: token }) })
        .then(function (r) {
          if (!r.body.ok) return { ok: false, error: r.body.error };
          setSession(r.body.token, r.body.user);
          return { ok: true, session: r.body.user };
        });
    },
    signInGoogleDemo: function () {
      return api("/api/auth/google", { method: "POST" })
        .then(function (r) { return r.body.ok ? { ok: true, session: r.body.user } : { ok: false, error: r.body.error }; });
    },
    signOut: function () {
      return api("/api/auth/logout", { method: "POST" }).then(function () { setSession(null, null); });
    },
    listMagicLinks: function () {
      return api("/api/dev/inbox").then(function (r) { return r.body.ok ? r.body.items : []; });
    },
  };

  function adapter() { return mode === "http" ? http : local; }

  var Auth = {
    mode: function () { return mode; },
    currentUser: function () { return userCache; },

    ensure: function () {
      if (ensurePromise) return ensurePromise;
      ensurePromise = new Promise(function (resolve) {
        var timer = setTimeout(function () { resolve("local"); }, 1500);
        fetch("/api/health", { cache: "no-store" })
          .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("health")); })
          .then(function (j) { clearTimeout(timer); resolve(j.ok ? "http" : "local"); })
          .catch(function () { clearTimeout(timer); resolve("local"); });
      }).then(function (m) {
        mode = m;
        if (mode !== "http") return mode;
        if (!sessionToken) return mode;
        /* validate cached session against the server */
        return api("/api/auth/me").then(function (r) {
          if (r.status === 200 && r.body.user) setSession(sessionToken, r.body.user);
          else setSession(null, null);
          return mode;
        });
      });
      return ensurePromise;
    },

    requestMagicLink: function (email) { return adapter().requestMagicLink(email); },
    consumeMagicLink: function (token) { return adapter().consumeMagicLink(token); },
    signInGoogleDemo: function () { return adapter().signInGoogleDemo(); },
    signOut: function () { return adapter().signOut(); },
    listMagicLinks: function () { return adapter().listMagicLinks(); },

    /* credit balance & ledger; local mode has no ledger */
    credits: function () {
      if (mode !== "http") return Promise.resolve({ balance: 0, reserved: 0, ledger: [], local: true });
      return api("/api/credits").then(function (r) {
        return r.status === 200 ? r.body : { balance: 0, reserved: 0, ledger: [], local: false };
      });
    },

    /* create a checkout session for a pack; local mode has no payments */
    checkout: function (pack) {
      if (mode !== "http") return Promise.resolve({ ok: false, error: "local" });
      return api("/api/checkout", { method: "POST", body: JSON.stringify({ pack: pack }) })
        .then(function (r) {
          return r.status === 200 && r.body.ok ? r.body : { ok: false, error: (r.body && r.body.error) || "checkout-failed" };
        });
    },

    /* uploads: presign -> direct PUT (production: S3 presigned URL) */
    presign: function (meta) {
      if (mode !== "http") return Promise.resolve({ ok: false, error: "local" });
      return api("/api/uploads/presign", { method: "POST", body: JSON.stringify(meta) })
        .then(function (r) { return r.status === 200 ? r.body : { ok: false, error: (r.body && r.body.error) || "presign-failed" }; });
    },

    /* jobs */
    createJob: function (params) {
      if (mode !== "http") return Promise.resolve({ ok: false, error: "local" });
      return api("/api/jobs", { method: "POST", body: JSON.stringify(params) })
        .then(function (r) { return r.status === 200 ? r.body : { ok: false, error: (r.body && r.body.error) || "job-failed" }; });
    },
    jobs: function () {
      if (mode !== "http") return Promise.resolve([]);
      return api("/api/jobs").then(function (r) { return r.status === 200 ? r.body.jobs : []; });
    },

    /* refresh the header balance chip from the server */
    refreshBalanceChip: function () {
      var strong = document.querySelector("#navAuth .auth-chip strong");
      if (!strong || mode !== "http") return Promise.resolve();
      return Auth.credits().then(function (c) { strong.textContent = String(c.balance); });
    },

    renderHeaderAuth: function () {
      var el = document.getElementById("navAuth");
      if (!el) return;
      if (userCache) {
        el.innerHTML =
          '<a class="auth-chip" href="account.html" title="' + userCache.email + '">' +
            '<span class="auth-dot" aria-hidden="true"></span>' +
            '<span data-i18n="nav.balance">Balance</span>' +
            '<strong>0</strong>' +
          '</a>';
      } else {
        el.innerHTML = '<a class="btn btn-light" href="login.html" data-i18n="nav.signin">Sign in</a>';
      }
    },
  };

  window.Auth = Auth;
})();
