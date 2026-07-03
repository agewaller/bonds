import { describe, it, expect } from "vitest";
import type { ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";

// healthz は prisma に触れないためダミーで足りる (実 DB 検証は integration 側)
const app = createApp({ prisma: {} as ExtendedPrismaClient, generate: null });

describe("healthz", () => {
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

describe("admin guard (fail closed)", () => {
  it("ADMIN_BREAKGLASS_TOKEN 未設定なら書き込みは 503", async () => {
    const saved = process.env.ADMIN_BREAKGLASS_TOKEN;
    delete process.env.ADMIN_BREAKGLASS_TOKEN;
    try {
      const res = await app.request("/api/dd/subjects", {
        method: "POST",
        body: JSON.stringify({ name: "x" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(503);
    } finally {
      if (saved !== undefined) process.env.ADMIN_BREAKGLASS_TOKEN = saved;
    }
  });

  it("トークン不一致は 401", async () => {
    const saved = process.env.ADMIN_BREAKGLASS_TOKEN;
    process.env.ADMIN_BREAKGLASS_TOKEN = "correct-token";
    try {
      const res = await app.request("/api/dd/subjects", {
        method: "POST",
        body: JSON.stringify({ name: "x" }),
        headers: { "Content-Type": "application/json", "x-admin-token": "wrong" },
      });
      expect(res.status).toBe(401);
    } finally {
      if (saved !== undefined) process.env.ADMIN_BREAKGLASS_TOKEN = saved;
      else delete process.env.ADMIN_BREAKGLASS_TOKEN;
    }
  });
});
