// 時間・知恵・モノのシェア — 純粋ドメインロジックのユニットテスト。
import { describe, it, expect } from "vitest";
import {
  SHARE_KINDS,
  GIFT_ACTION_TO_KIND,
  normalizeKind,
  normalizeDirection,
  canTransition,
  initialStatus,
  counterpartTargetStatus,
  canCounterpartRespond,
  shareEligibility,
  canAutoSend,
} from "../../src/lib/sharing.js";

describe("normalizeKind", () => {
  it("既知の種別はそのまま", () => {
    for (const k of SHARE_KINDS) expect(normalizeKind(k)).toBe(k);
  });
  it("未知/空は thing にフォールバック", () => {
    expect(normalizeKind("money")).toBe("thing");
    expect(normalizeKind(undefined)).toBe("thing");
  });
});

describe("gift アクション → 種別の写像", () => {
  it("teach/advise は知恵、do は時間、give/lend はモノ", () => {
    expect(GIFT_ACTION_TO_KIND.teach).toBe("wisdom");
    expect(GIFT_ACTION_TO_KIND.advise).toBe("wisdom");
    expect(GIFT_ACTION_TO_KIND.do).toBe("time");
    expect(GIFT_ACTION_TO_KIND.give).toBe("thing");
    expect(GIFT_ACTION_TO_KIND.lend).toBe("thing");
  });
});

describe("normalizeDirection", () => {
  it("既定は offer", () => {
    expect(normalizeDirection("xxx")).toBe("offer");
    expect(normalizeDirection("request")).toBe("request");
    expect(normalizeDirection("inbound")).toBe("inbound");
  });
});

describe("状態機械", () => {
  it("正しい遷移のみ許可", () => {
    expect(canTransition("proposed", "sent")).toBe(true);
    expect(canTransition("sent", "accepted")).toBe(true);
    expect(canTransition("sent", "declined")).toBe(true);
    expect(canTransition("accepted", "fulfilled")).toBe(true);
    expect(canTransition("proposed", "cancelled")).toBe(true);
  });
  it("不正な遷移は拒否 (終端・飛び越し)", () => {
    expect(canTransition("proposed", "accepted")).toBe(false); // sent を飛ばせない
    expect(canTransition("declined", "accepted")).toBe(false); // 終端
    expect(canTransition("fulfilled", "sent")).toBe(false); // 終端
    expect(canTransition("cancelled", "sent")).toBe(false); // 終端
  });
  it("inbound は accepted で開始、offer/request は proposed", () => {
    expect(initialStatus("inbound")).toBe("accepted");
    expect(initialStatus("offer")).toBe("proposed");
    expect(initialStatus("request")).toBe("proposed");
  });
});

describe("相手 (第三者) の公開応答", () => {
  it("accept/decline を対応状態へ写像", () => {
    expect(counterpartTargetStatus("accept")).toBe("accepted");
    expect(counterpartTargetStatus("decline")).toBe("declined");
  });
  it("sent のときだけ応答可能 (送信前・確定後は不可)", () => {
    expect(canCounterpartRespond("sent", "accept")).toBe(true);
    expect(canCounterpartRespond("sent", "decline")).toBe(true);
    expect(canCounterpartRespond("proposed", "accept")).toBe(false);
    expect(canCounterpartRespond("accepted", "accept")).toBe(false);
    expect(canCounterpartRespond("fulfilled", "decline")).toBe(false);
  });
});

describe("適格性ゲート (関係距離)", () => {
  it("遠い相手 (distance>=4) への頼みごと (request) は不適格", () => {
    expect(shareEligibility("request", 4).eligible).toBe(false);
    expect(shareEligibility("request", 5).eligible).toBe(false);
  });
  it("近い相手への request、および offer は適格", () => {
    expect(shareEligibility("request", 2).eligible).toBe(true);
    expect(shareEligibility("offer", 5).eligible).toBe(true);
  });
  it("inbound は常に適格 (記録のため)", () => {
    expect(shareEligibility("inbound", 5).eligible).toBe(true);
  });
});

describe("自動送信ゲート (既定は承認必須)", () => {
  it("近い相手 (distance<=2) への offer だけ自動送信の候補", () => {
    expect(canAutoSend("offer", 1)).toBe(true);
    expect(canAutoSend("offer", 2)).toBe(true);
    expect(canAutoSend("offer", 3)).toBe(false); // 遠い
    expect(canAutoSend("request", 1)).toBe(false); // 頼みごとは自動化しない
    expect(canAutoSend("inbound", 1)).toBe(false);
  });
});
