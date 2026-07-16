"use client";
// 時間の出品の公開ページ (予約リンクの飛び先)。空いている枠をひとつ選び、
// お名前と連絡先を入れて申し込む。有料はそのままお支払いページ (Stripe) へ進む。
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type OfferInfo = {
  title: string;
  description: string;
  displayName: string;
  methodLabel: string;
  minutes: number;
  priceJpy: number;
  acceptingBookings: boolean;
};
type IsoSlot = { start: string; end: string };

const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 15,
  boxSizing: "border-box",
};

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const dayLabel = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;
const timeLabel = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

export default function PublicOfferPage() {
  const { key } = useParams<{ key: string }>();
  const [info, setInfo] = useState<OfferInfo | null>(null);
  const [gone, setGone] = useState(false);
  const [options, setOptions] = useState<IsoSlot[] | null>(null);
  const [chosen, setChosen] = useState<IsoSlot | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestContact, setGuestContact] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/bff/public/offers/${key}`);
    if (!res.ok) {
      setGone(true);
      return;
    }
    setInfo((await res.json()) as OfferInfo);
    const r2 = await fetch(`/api/bff/public/offers/${key}/slots`);
    if (r2.ok) setOptions(((await r2.json()) as { options: IsoSlot[] }).options);
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  const book = async () => {
    if (!chosen) return;
    setError("");
    setBusy(true);
    const res = await fetch(`/api/bff/public/offers/${key}/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName, guestContact, message, slot: chosen }),
    });
    const body = (await res.json().catch(() => ({}))) as { detail?: string; confirmed?: boolean; checkoutUrl?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.detail ?? "受け付けできませんでした。時間をおいてお試しください");
      if (res.status === 409) {
        setChosen(null);
        await load();
      }
      return;
    }
    if (body.confirmed) {
      setConfirmed(true);
      return;
    }
    if (body.checkoutUrl) window.location.href = body.checkoutUrl; // お支払いへ (戻ると /thanks で確定を確認)
  };

  if (gone) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
        <p>このページは終了したか、見つかりませんでした。</p>
      </main>
    );
  }
  if (!info) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
        <p>読み込んでいます…</p>
      </main>
    );
  }

  if (confirmed) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
        <h1 style={{ fontSize: 22 }}>{info.title}</h1>
        <div style={{ marginTop: 24, padding: "20px 16px", background: "#f0fdf4", borderRadius: 12 }}>
          <p style={{ margin: 0, lineHeight: 1.9 }}>
            お申し込みを受け付けました。当日の進め方は、いただいた連絡先へあらためてお知らせします。
          </p>
        </div>
      </main>
    );
  }

  const byDate = new Map<string, IsoSlot[]>();
  for (const o of options ?? []) {
    const d = new Date(o.start);
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    byDate.set(k, [...(byDate.get(k) ?? []), o]);
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
      <p style={{ color: "#94a3b8", fontSize: 13, letterSpacing: 1 }}>
        {info.displayName ? `${info.displayName} の` : ""}お時間の受け付け
      </p>
      <h1 style={{ fontSize: 22 }}>{info.title}</h1>
      {info.description && <p style={{ lineHeight: 1.9, color: "#334155", whiteSpace: "pre-wrap" }}>{info.description}</p>}
      <p style={{ color: "#334155" }}>
        {info.methodLabel}、{info.minutes} 分。
        {info.priceJpy > 0 ? ` ${info.priceJpy.toLocaleString()} 円 (お支払いはカードで、この後の画面から)` : " 無料です"}
      </p>

      {!info.acceptingBookings && (
        <p style={{ padding: "12px 16px", background: "#fef9c3", borderRadius: 8 }}>
          ただいまお申し込みの受け付けを準備中です。しばらくしてからお試しください。
        </p>
      )}

      {info.acceptingBookings && options && options.length === 0 && (
        <p style={{ padding: "12px 16px", background: "#fef9c3", borderRadius: 8 }}>
          あいにく、いまお選びいただける時間がありません。
        </p>
      )}

      {info.acceptingBookings &&
        [...byDate.entries()].map(([k, slots]) => (
          <section key={k} style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 15, color: "#334155", margin: "0 0 8px" }}>{dayLabel(new Date(slots[0]!.start))}</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {slots.map((o) => {
                const on = chosen?.start === o.start;
                return (
                  <button
                    key={o.start}
                    onClick={() => setChosen(on ? null : o)}
                    aria-pressed={on}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      border: on ? "2px solid #2563eb" : "1px solid #cbd5e1",
                      background: on ? "#eff6ff" : "#fff",
                      color: "#1e293b",
                      fontSize: 14,
                      cursor: "pointer",
                    }}
                  >
                    {timeLabel(new Date(o.start))} から
                  </button>
                );
              })}
            </div>
          </section>
        ))}

      {chosen && (
        <section style={{ marginTop: 24, padding: "16px", border: "1px solid #e2e8f0", borderRadius: 12 }}>
          <p style={{ margin: "0 0 8px", color: "#334155" }}>
            選んだ時間: {dayLabel(new Date(chosen.start))} {timeLabel(new Date(chosen.start))} から {info.minutes} 分
          </p>
          <label style={{ display: "block", margin: "8px 0" }}>
            お名前 (必ず入れてください)
            <input style={input} value={guestName} onChange={(e) => setGuestName(e.target.value)} aria-label="お名前" />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            ご連絡先 (メールやお電話など。当日のご案内に使います)
            <input style={input} value={guestContact} onChange={(e) => setGuestContact(e.target.value)} aria-label="ご連絡先" />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            ご相談したいこと (任意)
            <textarea style={input} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="ご相談したいこと" />
          </label>
          {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
          <button
            style={{ padding: "12px 24px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
            disabled={busy || !guestName.trim()}
            onClick={() => void book()}
          >
            {busy ? "受け付けています…" : info.priceJpy > 0 ? "お支払いに進む" : "この内容で申し込む"}
          </button>
        </section>
      )}
    </main>
  );
}
