import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app.js";

describe("healthz", () => {
  const app = createApp();

  it("GET /api/healthz は 200 {status:ok} を返す", async () => {
    const res = await app.request("/api/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /healthz も 200 {status:ok} を返す (Cloud Run intercept 回避の冗長経路)", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
