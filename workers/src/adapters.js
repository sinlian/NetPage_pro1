/* DuoStage Workers — mail & payment adapters
   mail interface: { name, sendMagicLink(email, url) -> Promise<void> }
     DevInboxMailer records links into dev_inbox (GET /api/dev/inbox).
     Production: same interface with Resend/SES (env-bound API key).
   pay interface: { name, createCheckout(order, origin) -> { checkoutUrl } }
     DevPayAdapter points at checkout-dev.html (simulated Stripe page).
     Production: Stripe Checkout session + real webhook verification. */

function hex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function createDevInboxMailer(db) {
  return {
    name: "dev-inbox",
    async sendMagicLink(email, url) {
      const id = hex(crypto.getRandomValues(new Uint8Array(8)));
      await db.set("dev_inbox", id, { id, email, url, created: Date.now() });
      console.log("[mail:dev] magic link for", email, "->", url);
    },
  };
}

export function createDevPayAdapter() {
  return {
    name: "dev-pay",
    async createCheckout(order, origin) {
      return { checkoutUrl: origin + "/checkout-dev.html?order=" + encodeURIComponent(order.id) };
    },
  };
}
