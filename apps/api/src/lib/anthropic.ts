// Anthropic 呼び出し (cares の createMessageResilient を移植)。
// 鍵はサーバ側 env のみ (ADR-0006 相当)。フォールバック連鎖はしない。
import Anthropic from "@anthropic-ai/sdk";

// ランナーが依存する生成関数の抽象。テストではこれを差し替えて実 AI を呼ばずに検証する。
// 画像入力 (Vision)。名刺・名簿・スクショから人物を読み取るときに渡す。
export type ImageInput = { base64: string; mediaType: string };

export type GenerateArgs = {
  model: string;
  system: string;
  userMessage: string;
  maxTokens: number;
  timeoutMs: number;
  // 出力が max_tokens で途中で切れたとき、続きを最大この回数まで生成して繋ぐ。
  // 長い JSON 評価 (人物DD) の途中停止対策。既定 0 (継続しない)。
  maxContinuations?: number;
  // Vision: 与えると user メッセージに画像ブロックを添えて送る (名刺・名簿の読み取り)。
  images?: ImageInput[];
};

// Anthropic 画像 media_type は jpeg/png/webp/gif のみ。未知は jpeg に倒す (cares と同方針)。
function normalizeMediaType(mime: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  if (mime === "image/png" || mime === "image/webp" || mime === "image/gif") return mime;
  return "image/jpeg";
}
export type GenerateResult = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};
export type GenerateFn = (args: GenerateArgs) => Promise<GenerateResult>;

// "Premature close" 対策: stream:true で受信し delta を蓄積する。接続が切れても
// 1 文字でも受け取れていればそれを最終結果として返す (本文ゼロのときだけ再 throw)。
// stopReason も返す ("max_tokens" のとき呼び出し側が継続を判断する)。
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function createMessageResilient(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  options?: Anthropic.RequestOptions,
): Promise<{
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
}> {
  const stream = (await client.messages.create(
    { ...params, stream: true },
    options,
  )) as unknown as AsyncIterable<any>;
  let text = "";
  let model: string = params.model;
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;
  try {
    for await (const ev of stream) {
      if (ev.type === "message_start") {
        if (ev.message?.model) model = ev.message.model;
        inputTokens = ev.message?.usage?.input_tokens ?? inputTokens;
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        text += ev.delta.text;
      } else if (ev.type === "message_delta") {
        if (ev.usage?.output_tokens != null) outputTokens = ev.usage.output_tokens;
        if (ev.delta?.stop_reason != null) stopReason = ev.delta.stop_reason;
      }
    }
  } catch (err) {
    if (!text) throw err; // 1 文字も受け取れていなければ本物の失敗
    stopReason = stopReason ?? "premature_close";
    console.warn(
      JSON.stringify({
        event: "ai_stream_recovered",
        detail: err instanceof Error ? err.message : String(err),
        chars: text.length,
      }),
    );
  }
  return { text, model, inputTokens, outputTokens, stopReason };
}

/** env の ANTHROPIC_API_KEY で GenerateFn を作る。鍵未設定なら null (呼び出し側で 503)。 */
export function buildAnthropicGenerate(): GenerateFn | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return async ({ model, system, userMessage, maxTokens, timeoutMs, maxContinuations = 0, images }) => {
    const systemBlocks = [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }];
    // 画像があれば user メッセージを画像ブロック + テキストの配列にする (Vision)。
    const userContent: Anthropic.MessageParam["content"] =
      images && images.length > 0
        ? [
            ...images.map((img) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: normalizeMediaType(img.mediaType), data: img.base64 },
            })),
            { type: "text" as const, text: userMessage },
          ]
        : userMessage;
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];
    let full = "";
    let model_ = model;
    let inputTokens = 0;
    let outputTokens = 0;
    // 初回 + 継続を回す。max_tokens で切れている間だけ、これまでの出力を assistant の
    // 発話として渡して「続き」を生成させ、文字列として連結する (JSON もそのまま繋がる)。
    for (let attempt = 0; attempt <= maxContinuations; attempt++) {
      const res = await createMessageResilient(
        client,
        {
          model,
          max_tokens: maxTokens,
          system: systemBlocks,
          // 継続時はこれまでの出力を assistant 発話として渡す。API は末尾空白を
          // 許さないため trimEnd する (JSON の途中はトークン間空白が無意味なので安全)。
          messages: full ? [...messages, { role: "assistant", content: full.trimEnd() }] : messages,
        },
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      full += res.text;
      model_ = res.model;
      inputTokens += res.inputTokens;
      outputTokens += res.outputTokens;
      if (res.stopReason !== "max_tokens") break; // 完了 (または継続不能な打ち切り)
    }
    if (!full.trim()) throw new Error("empty_response");
    return { text: full, model: model_, inputTokens, outputTokens };
  };
}
