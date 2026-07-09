// 同姓同名の特定 (identify) の純粋ロジックのテスト。
import { describe, it, expect } from "vitest";
import {
  parseIdentifyCandidates,
  clampProfileHint,
  buildIdentifyUserMessage,
  identifyQueries,
  buildIdentifyDigest,
  IDENTIFY_MAX_CANDIDATES,
  IDENTIFY_DESCRIPTION_MAX,
  PROFILE_HINT_MAX,
} from "../../src/lib/identify.js";

describe("parseIdentifyCandidates", () => {
  it("正しい JSON から候補を取り出す", () => {
    const text = JSON.stringify({
      candidates: [
        { name: "山田太郎", description: "1950年生まれの政治家。元総務大臣" },
        { name: "山田太郎", description: "1967年生まれの参議院議員。表現の自由を掲げる" },
      ],
    });
    const out = parseIdentifyCandidates(text);
    expect(out).toHaveLength(2);
    expect(out[0]!.name).toBe("山田太郎");
    expect(out[1]!.description).toContain("参議院議員");
  });

  it("JSON の前後の文章を無視し、記号装飾は取り除く (BR-09 最終防衛線)", () => {
    const text = `候補は次のとおりです。\n{"candidates":[{"name":"**山田太郎**","description":"※1950年生まれの政治家"}]}\n以上です。`;
    const out = parseIdentifyCandidates(text);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("山田太郎");
    expect(out[0]!.description).toBe("1950年生まれの政治家");
  });

  it("候補は最大件数で打ち切り、description は上限に丸める", () => {
    const long = "あ".repeat(IDENTIFY_DESCRIPTION_MAX + 50);
    const text = JSON.stringify({
      candidates: Array.from({ length: 8 }, (_, i) => ({
        name: `候補${i}`,
        description: long,
      })),
    });
    const out = parseIdentifyCandidates(text);
    expect(out).toHaveLength(IDENTIFY_MAX_CANDIDATES);
    expect(out[0]!.description).toHaveLength(IDENTIFY_DESCRIPTION_MAX);
  });

  it("壊れた出力・欠けた項目は候補ゼロ/除外 (名前のみで続行できる)", () => {
    expect(parseIdentifyCandidates("これは JSON ではありません")).toEqual([]);
    expect(parseIdentifyCandidates('{"candidates":"文字列"}')).toEqual([]);
    expect(
      parseIdentifyCandidates(
        JSON.stringify({ candidates: [{ name: "名前だけ" }, { description: "説明だけ" }, 42, null] }),
      ),
    ).toEqual([]);
  });
});

describe("clampProfileHint", () => {
  it("文字列を整えて上限に丸め、空や非文字列は null", () => {
    expect(clampProfileHint("  1950年生まれの政治家  ")).toBe("1950年生まれの政治家");
    expect(clampProfileHint("あ".repeat(PROFILE_HINT_MAX + 100))).toHaveLength(PROFILE_HINT_MAX);
    expect(clampProfileHint("")).toBeNull();
    expect(clampProfileHint("   ")).toBeNull();
    expect(clampProfileHint(42)).toBeNull();
    expect(clampProfileHint(undefined)).toBeNull();
  });
});

describe("buildIdentifyUserMessage", () => {
  it("名前を入力欄として渡す", () => {
    expect(buildIdentifyUserMessage("山田太郎")).toBe("名前: 山田太郎");
  });

  it("検索の抜粋があれば参考情報として添える", () => {
    const msg = buildIdentifyUserMessage("山田太郎", "出典 https://x/ : 山田太郎 参議院議員");
    expect(msg).toContain("名前: 山田太郎");
    expect(msg).toContain("参考情報");
    expect(msg).toContain("参議院議員");
  });

  it("空の検索抜粋は無視して名前だけ", () => {
    expect(buildIdentifyUserMessage("山田太郎", "   ")).toBe("名前: 山田太郎");
  });
});

describe("identifyQueries / buildIdentifyDigest", () => {
  it("同姓同名の別人を拾う検索クエリを作る", () => {
    const q = identifyQueries("山田太郎");
    expect(q.length).toBeGreaterThanOrEqual(2);
    expect(q.every((x) => x.includes("山田太郎"))).toBe(true);
    expect(q.some((x) => x.includes("同姓同名"))).toBe(true);
  });

  it("検索結果を出典つきの抜粋にまとめ、上限8件で打ち切る", () => {
    const results = Array.from({ length: 12 }, (_, i) => ({
      title: `記事${i}`,
      url: `https://example.com/${i}`,
      snippet: "あ".repeat(300),
    }));
    const digest = buildIdentifyDigest(results);
    const lines = digest.split("\n");
    expect(lines).toHaveLength(8);
    expect(lines[0]).toContain("出典 https://example.com/0");
  });
});
