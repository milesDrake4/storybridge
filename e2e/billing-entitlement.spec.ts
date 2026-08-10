import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

const webhookSecret = "test-stripe-webhook-secret";

function signature(payload: string, timestamp: number) {
  return createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
}

test("rejects a lifecycle event when the signed raw body is changed", async ({
  request,
}) => {
  const timestamp = Math.floor(Date.now() / 1_000);
  const payload = JSON.stringify({
    created: timestamp,
    data: {
      object: {
        id: "cs_test_tampered",
        metadata: {},
        object: "checkout.session",
      },
    },
    id: "evt_test_tampered",
    livemode: false,
    object: "event",
    type: "checkout.session.completed",
  });
  const response = await request.post("/api/v1/billing/stripe-webhook", {
    data: `${payload}\n`,
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature(payload, timestamp)}`,
    },
  });

  expect(response.status()).toBe(400);
  expect(await response.body()).toHaveLength(0);
});

test("rejects stale signed lifecycle events before entitlement processing", async ({
  request,
}) => {
  const timestamp = Math.floor(Date.now() / 1_000) - 301;
  const payload = JSON.stringify({
    created: timestamp,
    data: { object: { hostile: true } },
    id: "evt_test_stale",
    livemode: false,
    object: "event",
    type: "customer.created",
  });
  const response = await request.post("/api/v1/billing/stripe-webhook", {
    data: payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature(payload, timestamp)}`,
    },
  });

  expect(response.status()).toBe(400);
  expect(await response.body()).toHaveLength(0);
});
