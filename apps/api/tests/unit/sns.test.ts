// SNS 情報の構造化・URL 組み立て・検索クエリのユニットテスト。
import { describe, it, expect } from "vitest";
import {
  parseSnsField,
  serializeSnsEntries,
  snsSearchQueries,
  snsPlatformLabel,
  extractSnsCandidates,
  parseSnsCandidates,
} from "../../src/lib/sns.js";

describe("extractSnsCandidates (本人らしき SNS の候補・未確認)", () => {
  it("検索結果からプロフィールの形をした URL だけを候補にする (投稿・一般サイトは除く)", () => {
    const results = [
      { url: "https://x.com/tanaka_taro" }, // 候補
      { url: "https://x.com/tanaka_taro/status/123456" }, // 投稿 → 除外
      { url: "https://www.linkedin.com/in/taro-tanaka" }, // 候補
      { url: "https://example.com/profile/tanaka" }, // 一般サイト → 除外
      { url: "https://www.instagram.com/p/abc123/" }, // 投稿 → 除外
      { url: "https://x.com/another_tanaka" }, // 同じ platform の 2 件目 → 乱立させない
    ];
    const cands = extractSnsCandidates(results, []);
    expect(cands.map((c) => `${c.platform}:${c.handle}`)).toEqual(["x:tanaka_taro", "linkedin:taro-tanaka"]);
  });

  it("既に登録済みの platform には候補を足さない", () => {
    const existing = parseSnsField("https://x.com/registered");
    const cands = extractSnsCandidates([{ url: "https://x.com/someone_else" }], existing);
    expect(cands).toHaveLength(0);
  });
});

describe("parseSnsCandidates", () => {
  it("JSON 文字列を読み、壊れていれば空", () => {
    const arr = [{ platform: "x", handle: "a", url: "https://x.com/a" }];
    expect(parseSnsCandidates(JSON.stringify(arr))).toHaveLength(1);
    expect(parseSnsCandidates("broken")).toEqual([]);
    expect(parseSnsCandidates(null)).toEqual([]);
  });
});

describe("parseSnsField", () => {
  it("URL から platform と handle と正規 URL を作る", () => {
    const e = parseSnsField("https://twitter.com/shibusawa_e");
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ platform: "x", handle: "shibusawa_e", url: "https://x.com/shibusawa_e" });
  });

  it("複数行・カンマ区切り・箇条書き記号を捌く", () => {
    const e = parseSnsField("- https://www.instagram.com/hanako/\nnote: taro_note, https://github.com/octocat");
    const platforms = e.map((x) => x.platform).sort();
    expect(platforms).toEqual(["github", "instagram", "note"]);
    expect(e.find((x) => x.platform === "note")?.url).toBe("https://note.com/taro_note");
  });

  it("linkedin の /in/ と youtube の @ を正しく handle 化する", () => {
    const e = parseSnsField("https://www.linkedin.com/in/john-doe\nhttps://www.youtube.com/@channelName");
    expect(e.find((x) => x.platform === "linkedin")?.handle).toBe("john-doe");
    expect(e.find((x) => x.platform === "youtube")?.handle).toBe("channelName");
  });

  it("JSON 文字列 (取込で入る形) も読める", () => {
    const e = parseSnsField('[{"url":"https://x.com/foo"},"https://note.com/bar"]');
    expect(e.map((x) => x.platform).sort()).toEqual(["note", "x"]);
  });

  it("同じアカウントの重複は 1 件にまとめる", () => {
    const e = parseSnsField("https://x.com/foo\nx: foo");
    expect(e).toHaveLength(1);
  });

  it("platform 不明の素の @handle は落とす (誤って X 扱いしない)", () => {
    expect(parseSnsField("@somebody")).toHaveLength(0);
  });

  it("未知ホストは blog として URL をそのまま持つ", () => {
    const e = parseSnsField("https://example.com/taro/diary");
    expect(e[0]!.platform).toBe("blog");
    expect(e[0]!.url).toBe("https://example.com/taro/diary");
  });

  it("空・null は空配列", () => {
    expect(parseSnsField(null)).toEqual([]);
    expect(parseSnsField("")).toEqual([]);
  });
});

describe("serializeSnsEntries", () => {
  it("1 行 1 件の URL テキストに戻し、重複を除く", () => {
    const text = serializeSnsEntries([
      { platform: "x", handle: "foo", url: "https://x.com/foo" },
      { platform: "x", handle: "foo", url: "https://x.com/foo" },
      { platform: "note", handle: "bar", url: "https://note.com/bar" },
    ]);
    expect(text).toBe("https://x.com/foo\nhttps://note.com/bar");
  });
});

describe("snsSearchQueries", () => {
  it("ハンドルを添えて近況クエリを作る (別人を拾いにくくする)", () => {
    const q = snsSearchQueries("渋沢 栄一", [{ platform: "x", handle: "shibusawa_e", url: "https://x.com/shibusawa_e" }]);
    expect(q[0]).toContain("shibusawa_e");
    expect(q[0]).toContain("渋沢 栄一");
  });

  it("SNS が無ければ氏名+所属の一般クエリにフォールバック", () => {
    const q = snsSearchQueries("山田 太郎", [], "山田商店");
    expect(q).toHaveLength(1);
    expect(q[0]).toContain("山田商店");
  });
});

describe("snsPlatformLabel", () => {
  it("既知は日本語ラベル、未知はそのまま", () => {
    expect(snsPlatformLabel("x")).toContain("X");
    expect(snsPlatformLabel("unknown")).toBe("unknown");
  });
});
