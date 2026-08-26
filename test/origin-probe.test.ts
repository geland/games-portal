import { describe, expect, it } from "vitest";
import { testable } from "../release/origin-probe/src/worker";

describe("authenticated release origin probe", () => {
  it("accepts only constrained public release keys", () => {
    expect(testable.validateProbeKey("releases/astro-bro/v1.0.0/web/index.html")).toBe(
      "releases/astro-bro/v1.0.0/web/index.html"
    );
    expect(testable.validateProbeKey("downloads/astro-bro/v1.0.0/.gregeland-cache-probe.zip")).toBe(
      "downloads/astro-bro/v1.0.0/.gregeland-cache-probe.zip"
    );
    expect(testable.validateProbeKey("manifests/astro-bro/stable.json")).toBeNull();
    expect(testable.validateProbeKey("downloads/astro-bro/v1.0.0/../private.zip")).toBeNull();
  });

  it("uses a bearer secret without accepting missing or partial credentials", async () => {
    const token = "a".repeat(64);
    expect(await testable.isAuthorized(new Request("https://probe.test/v1/probe", {
      headers: { authorization: `Bearer ${token}` }
    }), token)).toBe(true);
    expect(await testable.isAuthorized(new Request("https://probe.test/v1/probe", {
      headers: { authorization: `Bearer ${token.slice(0, -1)}` }
    }), token)).toBe(false);
    expect(await testable.isAuthorized(new Request("https://probe.test/v1/probe"), token)).toBe(false);
  });

  it("relays only the bounded origin metadata needed by the publisher", () => {
    const headers = testable.originResultHeaders(new Response(null, {
      status: 404,
      headers: {
        "cf-cache-status": "BYPASS",
        "cf-ray": "abc-SEA",
        "set-cookie": "must-not-appear"
      }
    }));
    expect(headers.get("x-gregeland-origin-status")).toBe("404");
    expect(headers.get("x-gregeland-origin-cf-cache-status")).toBe("BYPASS");
    expect(headers.get("x-gregeland-origin-cf-ray")).toBe("abc-SEA");
    expect(headers.get("set-cookie")).toBeNull();
  });
});
