import { describe, it, expect } from "vitest";
import { findTextAttachments, decodeGmailData, headerValue, validatePlaudDigest, type GmailPart } from "../../src/lib/plaud.js";

describe("findTextAttachments", () => {
  it("MIME ツリーを歩いて、テキストの添付だけを拾う", () => {
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/html", filename: "", body: { data: "x" } }, // 本文 (filename 無し) は拾わない
        { mimeType: "application/pdf", filename: "report.pdf", body: { attachmentId: "a0" } }, // PDF は対象外
        { mimeType: "text/plain", filename: "transcript.txt", body: { attachmentId: "a1" } },
        {
          mimeType: "multipart/alternative",
          parts: [{ mimeType: "application/octet-stream", filename: "notes.md", body: { attachmentId: "a2" } }],
        },
      ],
    };
    const atts = findTextAttachments(payload);
    expect(atts.map((a) => a.filename)).toEqual(["transcript.txt", "notes.md"]);
    expect(atts[0]!.attachmentId).toBe("a1");
  });
});

describe("decodeGmailData", () => {
  it("base64url を UTF-8 に戻し、CRLF を LF に整える", () => {
    const data = Buffer.from("会議メモ\r\n次回は金曜", "utf-8").toString("base64url");
    expect(decodeGmailData(data)).toBe("会議メモ\n次回は金曜");
    expect(decodeGmailData("")).toBeNull();
    expect(decodeGmailData(123)).toBeNull();
  });
});

describe("headerValue", () => {
  it("大文字小文字を無視して引く", () => {
    expect(headerValue([{ name: "Subject", value: "打ち合わせ" }], "subject")).toBe("打ち合わせ");
    expect(headerValue(undefined, "subject")).toBe("");
  });
});

describe("validatePlaudDigest", () => {
  it("タスクと課題を検証し、記号を除き、件数と長さを抑える", () => {
    const d = validatePlaudDigest({
      summary: "**要旨** です",
      tasks: [
        { text: "資料を金曜までに送る", kind: "task" },
        { text: "予算の扱いが未決", kind: "issue" },
        { text: "", kind: "task" }, // 空は捨てる
        { text: "kind が変", kind: "banana" }, // 不明 kind は task に
      ],
    });
    expect(d.summary).not.toContain("**");
    expect(d.tasks).toHaveLength(3);
    expect(d.tasks[1]).toMatchObject({ kind: "issue", done: false });
    expect(d.tasks[2]!.kind).toBe("task");
  });

  it("壊れた入力は空で返す", () => {
    expect(validatePlaudDigest(null)).toEqual({ summary: "", tasks: [] });
  });
});
