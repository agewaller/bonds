// 人物DD の途中停止対策 — createMessageResilient が stop_reason を拾い、
// max_tokens で切れたことを呼び出し側 (継続ループ) に伝えられることを検証する。
// 実 SDK は使わず、client.messages.create を偽のストリームで差し替える。
import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createMessageResilient } from "../../src/lib/anthropic.js";

// message_start → text_delta*（→ message_delta で stop_reason/usage）を流す偽ストリーム
function fakeStream(chunks: string[], stopReason: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "message_start", message: { model: "claude-sonnet-5", usage: { input_tokens: 10 } } };
      for (const c of chunks) {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: c } };
      }
      yield { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: chunks.length } };
    },
  };
}

function fakeClient(stream: unknown): Anthropic {
  return { messages: { create: async () => stream } } as unknown as Anthropic;
}

describe("createMessageResilient", () => {
  it("完了時は stopReason=end_turn を返す", async () => {
    const client = fakeClient(fakeStream(['{"ok":', "true}"], "end_turn"));
    const r = await createMessageResilient(client, {
      model: "claude-sonnet-5",
      max_tokens: 100,
      messages: [{ role: "user", content: "x" }],
    });
    expect(r.text).toBe('{"ok":true}');
    expect(r.stopReason).toBe("end_turn");
    expect(r.model).toBe("claude-sonnet-5");
    expect(r.inputTokens).toBe(10);
  });

  it("max_tokens で切れたら stopReason=max_tokens を返す (継続の判断材料)", async () => {
    const client = fakeClient(fakeStream(['{"partial":"あ'], "max_tokens"));
    const r = await createMessageResilient(client, {
      model: "claude-sonnet-5",
      max_tokens: 4,
      messages: [{ role: "user", content: "x" }],
    });
    expect(r.stopReason).toBe("max_tokens");
    expect(r.text).toBe('{"partial":"あ');
  });

  it("ストリームが途中で切れても受信済みは返し、stopReason は premature_close", async () => {
    const broken = {
      async *[Symbol.asyncIterator]() {
        yield { type: "message_start", message: { model: "claude-sonnet-5" } };
        yield { type: "content_block_delta", delta: { type: "text_delta", text: "半分" } };
        throw new Error("Premature close");
      },
    };
    const r = await createMessageResilient(fakeClient(broken), {
      model: "claude-sonnet-5",
      max_tokens: 100,
      messages: [{ role: "user", content: "x" }],
    });
    expect(r.text).toBe("半分");
    expect(r.stopReason).toBe("premature_close");
  });
});
