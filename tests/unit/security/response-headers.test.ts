import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

describe("browser security response headers", () => {
  it("applies the closed-beta baseline to every route", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");

    const rules = await nextConfig.headers!();
    const globalRule = rules.find((rule) => rule.source === "/(.*)");
    const headers = Object.fromEntries(
      (globalRule?.headers ?? []).map(({ key, value }) => [key, value]),
    );

    expect(headers).toMatchObject({
      "Cross-Origin-Opener-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Strict-Transport-Security": "max-age=31536000",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
  });
});
