/* DuoStage backend skeleton — payment adapter
   Interface: { name, createCheckout(order, origin) -> { checkoutUrl } }
   DevPayAdapter sends the buyer to checkout-dev.html, a stand-in for the
   Stripe hosted page. "Pay" / "Cancel" there call POST /api/pay/confirm,
   which plays the role of the stripe webhook (idempotent by order status).
   Production: implement the same interface with Stripe Checkout and verify
   real webhook signatures in the confirm route instead. */
"use strict";

function createDevPayAdapter() {
  return {
    name: "dev-pay",
    async createCheckout(order, origin) {
      return { checkoutUrl: origin + "/checkout-dev.html?order=" + encodeURIComponent(order.id) };
    },
  };
}

module.exports = { createDevPayAdapter };
