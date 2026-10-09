/* DuoStage backend skeleton — mail adapter
   Interface: { sendMagicLink(email, url) -> Promise<void> }
   DevInboxMailer records links into the dev_inbox table (surfaced by
   GET /api/dev/inbox) and logs them. Production: implement the same
   interface with Resend/SES and inject it in app.js. */
"use strict";
const crypto = require("crypto");

function createDevInboxMailer(db) {
  return {
    name: "dev-inbox",
    async sendMagicLink(email, url) {
      const id = crypto.randomBytes(8).toString("hex");
      db.set("dev_inbox", id, { id, email, url, created: Date.now() });
      console.log("[mail:dev] magic link for", email, "->", url);
    },
  };
}

module.exports = { createDevInboxMailer };
