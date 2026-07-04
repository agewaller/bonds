// Anthropic 呼び出し (cares の createMessageResilient を移植)。
// 鍵はサーバ側 env のみ (ADR-0006 相当)。フォールバック連鎖はしない。
import Anthropic from "@anthropic-ai/sdk";

// ランナーが依存する生成関数の抽象。テストではこれを差し替えて実 AI を呼ばずに検証する。
export type GenerateArgs = {
  model: string;
  system: string;
  userMessage: string;
  maxTokens: number;
  timeoutMs: number;
};
export type GenerateResult = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};
export type GenerateFn = (args: GenerateArgs) => Promise<GenerateResult>;

// "Premature close" 対策: stream:true で受信し delta を蓄積する。接続が切れても
// 1 文字でも受け取れていればそれを最終結果として返す (本文ゼロのときだけ再 throw)。
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function createMessageResilient(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  options?: Anthropic.RequestOptions,
): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number }> {
  const stream = (await client.messages.create(
    { ...params, stream: true },
    options,
  )) as unknown as AsyncIterable<any>;
  let text = "";
  let model: string = params.model;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    for await (const ev of stream) {
      if (ev.type === "message_start") {
        if (ev.message?.model) model = ev.message.model;
        inputTokens = ev.message?.usage?.input_tokens ?? inputTokens;
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        text += ev.delta.text;
      } else if (ev.type === "message_delta") {
        if (ev.usage?.output_tokens != null) outputTokens = ev.usage.output_tokens;
      }
    }
  } catch (err) {
    if (!text) throw err; // 1 文字も受け取れていなければ本物の失敗
    console.warn(
      JSON.stringify({
        event: "ai_stream_recovered",
        detail: err instanceof Error ? err.message : String(err),
        chars: text.length,
      }),
    );
  }
  return { text, model, inputTokens, outputTokens };
}

/** env の ANTHROPIC_API_KEY で GenerateFn を作る。鍵未設定なら null (呼び出し側で 503)。 */
export function buildAnthropicGenerate(): GenerateFn | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return async ({ model, system, userMessage, maxTokens, timeoutMs }) => {
    const res = await createMessageResilient(
      client,
      {
        model,
        max_tokens: maxTokens,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userMessage }],
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.text.trim()) throw new Error("empty_response");
    return res;
  };
}
