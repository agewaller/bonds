"use client";
// 連絡先詳細のシェア欄 — 時間・知恵・モノを差し出す / お願いする / いただいた記録。
// 送ると相手用のリンクが発行され、相手はログインなしで受け取り/辞退と一言を返せる。
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/client-api";
import { t } from "../lib/i18n";

type Share = {
  id: string;
  kind: string;
  direction: string;
  title: string;
  status: string;
  createdAt: string;
};

const input = { width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8 } as const;
const btn = (primary = true) =>
  ({
    padding: "8px 16px",
    background: primary ? "#2563eb" : "#fff",
    color: primary ? "#fff" : "#2563eb",
    border: "1px solid #2563eb",
    borderRadius: 8,
    cursor: "pointer",
  }) as const;

const KIND_LABEL: Record<string, string> = { time: "時間", wisdom: "知恵", thing: "モノ" };
const DIRECTION_LABEL: Record<string, string> = {
  offer: "差し出す",
  request: "お願い",
  inbound: "いただいた",
};
const STATUS_LABEL: Record<string, string> = {
  proposed: "準備中",
  sent: "お知らせ済み",
  accepted: "受けてもらえました",
  declined: "今回は見送り",
  fulfilled: "実現しました",
  cancelled: "取りやめ",
};

export function SharesSection({ contactId }: { contactId: string }) {
  const [shares, setShares] = useState<Share[]>([]);
  const [kind, setKind] = useState("time");
  const [direction, setDirection] = useState("offer");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch(`shares?contactId=${contactId}`);
    if (res.ok) setShares((await res.json()).shares ?? []);
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    setShareUrl("");
    try {
      const res = await apiFetch(`contacts/${contactId}/shares`, {
        method: "POST",
        body: JSON.stringify({ kind, direction, title: title.trim(), message: message.trim() || null }),
      });
      const rb = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(rb.detail ?? "うまくいきませんでした");
        return;
      }
      setNotice(direction === "inbound" ? "いただいた記録を残しました" : "準備しました。お知らせすると相手用のリンクが発行されます");
      setTitle("");
      setMessage("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, path: string, body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`shares/${id}/${path}`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
      const rb = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(rb.detail ?? "うまくいきませんでした");
        return;
      }
      if (rb.shareUrl) {
        setShareUrl(rb.shareUrl);
        setNotice(
          rb.delivered
            ? "メールでお知らせしました。下のリンクを別の方法で伝えても構いません"
            : "相手用のリンクができました。メールや口頭でお伝えください",
        );
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 18 }}>時間・知恵・モノのシェア</h2>
      <p style={{ color: "#64748b", fontSize: 14 }}>
        お金を介さないやりとりが、つながりを深くします。手伝えること、教えられること、お譲りできるものを気軽に。
      </p>
      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>
      )}
      {shareUrl && (
        <p style={{ background: "#eff6ff", padding: 8, borderRadius: 8, wordBreak: "break-all" }}>
          相手用リンク: <a href={shareUrl} style={{ color: "#2563eb" }}>{shareUrl}</a>
        </p>
      )}

      <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
        <select style={{ ...input, width: "auto" }} value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="やりとりの向き">
          <option value="offer">差し出す</option>
          <option value="request">お願いする</option>
          <option value="inbound">いただいた記録</option>
        </select>
        <select style={{ ...input, width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="何を">
          <option value="time">時間 (手伝う・付き添う)</option>
          <option value="wisdom">知恵 (教える・相談に乗る)</option>
          <option value="thing">モノ (譲る・貸す)</option>
        </select>
      </div>
      <label style={{ display: "block", margin: "8px 0" }}>
        内容
        <input
          style={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 引っ越しを手伝えます / 確定申告の相談に乗れます / 本をお貸しします"
        />
      </label>
      <label style={{ display: "block", margin: "8px 0" }}>
        ひとこと (任意)
        <textarea style={input} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <button style={btn()} onClick={() => void create()} disabled={busy || !title.trim()}>
        {direction === "inbound" ? "記録する" : "準備する"}
      </button>

      {shares.length > 0 && (
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: "none" }}>
          {shares.map((s) => (
            <li key={s.id} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", marginBottom: 8 }}>
              <div>
                <strong>{s.title}</strong>
                <span style={{ color: "#64748b", marginLeft: 8, fontSize: 13 }}>
                  {KIND_LABEL[s.kind] ?? s.kind} ・ {DIRECTION_LABEL[s.direction] ?? s.direction} ・ {STATUS_LABEL[s.status] ?? s.status}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                {s.status === "proposed" && (
                  <button style={btn(false)} onClick={() => void act(s.id, "send")} disabled={busy}>
                    お知らせする (リンク発行)
                  </button>
                )}
                {s.status === "accepted" && (
                  <button style={btn(false)} onClick={() => void act(s.id, "status", { status: "fulfilled" })} disabled={busy}>
                    実現した
                  </button>
                )}
                {(s.status === "proposed" || s.status === "sent" || s.status === "accepted") && (
                  <button style={btn(false)} onClick={() => void act(s.id, "status", { status: "cancelled" })} disabled={busy}>
                    取りやめる
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
