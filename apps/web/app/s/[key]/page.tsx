"use client";
// 日程調整の公開ページ (共有リンクの飛び先)。アカウント不要で、空いている枠から
// ご都合のよい時間を選んで送るだけ。見えるのは空き枠と名乗りだけで、予定の中身は出ない。
// 文言は寄り添い基調・専門用語なし (65 歳ペルソナ)。
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type ShareInfo = {
  locked: boolean;
  title: string;
  displayName: string;
  methodLabel?: string;
  note?: string;
  slotMinutes?: number;
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
const btn = (primary = true): React.CSSProperties => ({
  padding: "12px 24px",
  borderRadius: 8,
  border: primary ? "none" : "1px solid #cbd5e1",
  background: primary ? "#2563eb" : "#fff",
  color: primary ? "#fff" : "#334155",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
});

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const dayLabel = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;
const timeLabel = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

export default function PublicSchedulePage() {
  const { key } = useParams<{ key: string }>();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [gone, setGone] = useState(false);
  const [proof, setProof] = useState("");
  const [password, setPassword] = useState("");
  const [options, setOptions] = useState<IsoSlot[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]); // start ISO の配列 (最大 3)
  const [guestName, setGuestName] = useState("");
  const [guestContact, setGuestContact] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const loadInfo = useCallback(
    async (p: string) => {
      const q = p ? `?proof=${encodeURIComponent(p)}` : "";
      const res = await fetch(`/api/bff/public/schedule/${key}${q}`);
      if (!res.ok) {
        setGone(true);
        return;
      }
      const body = (await res.json()) as ShareInfo;
      setInfo(body);
      if (!body.locked) {
        const r2 = await fetch(`/api/bff/public/schedule/${key}/slots${q}`);
        if (r2.ok) setOptions(((await r2.json()) as { options: IsoSlot[] }).options);
      }
    },
    [key],
  );

  useEffect(() => {
    void loadInfo("");
  }, [loadInfo]);

  const unlock = async () => {
    setError("");
    const res = await fetch(`/api/bff/public/schedule/${key}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((body as { detail?: string }).detail ?? "あいことばが違うようです");
      return;
    }
    const p = (body as { proof: string }).proof;
    setProof(p);
    await loadInfo(p);
  };

  const toggle = (start: string) => {
    setChosen((cur) => (cur.includes(start) ? cur.filter((x) => x !== start) : cur.length >= 3 ? cur : [...cur, start]));
  };

  const submit = async () => {
    if (!options) return;
    setError("");
    setBusy(true);
    const candidates = options.filter((o) => chosen.includes(o.start));
    const res = await fetch(`/api/bff/public/schedule/${key}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName, guestContact, message, candidates, proof }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError((body as { detail?: string }).detail ?? "送信できませんでした。時間をおいてお試しください");
      if (res.status === 409) {
        setChosen([]);
        await loadInfo(proof);
      }
      return;
    }
    setDone(true);
  };

  if (gone) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
        <p>このページは終了したか、見つかりませんでした。お手数ですが、リンクを送ってくれた方にご確認ください。</p>
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

  const heading = info.title || "お会いする日時のご相談";
  const who = info.displayName ? `${info.displayName} より` : "";

  if (done) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
        <h1 style={{ fontSize: 22 }}>{heading}</h1>
        <div style={{ marginTop: 24, padding: "20px 16px", background: "#f0fdf4", borderRadius: 12 }}>
          <p style={{ margin: 0, lineHeight: 1.9 }}>
            ご都合をお送りいただき、ありがとうございました。内容を確かめて、決まった日時をあらためてご連絡します。
            このページはもう閉じていただいて大丈夫です。
          </p>
        </div>
      </main>
    );
  }

  if (info.locked) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
        <p style={{ color: "#94a3b8", fontSize: 13, letterSpacing: 1 }}>日程のご相談 {who}</p>
        <h1 style={{ fontSize: 22 }}>{heading}</h1>
        <p style={{ lineHeight: 1.9 }}>このページを開くには、お伝えしてある「あいことば」を入れてください。</p>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            style={{ ...input, flex: 1 }}
            type="password"
            aria-label="あいことば"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void unlock()}
          />
          <button style={btn()} onClick={() => void unlock()}>開く</button>
        </div>
        {error && <p role="alert" style={{ color: "#b91c1c", marginTop: 8 }}>{error}</p>}
      </main>
    );
  }

  // 日付ごとにまとめて表示する (枠が多くても迷わない)
  const byDate = new Map<string, IsoSlot[]>();
  for (const o of options ?? []) {
    const d = new Date(o.start);
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    byDate.set(k, [...(byDate.get(k) ?? []), o]);
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
      <p style={{ color: "#94a3b8", fontSize: 13, letterSpacing: 1 }}>日程のご相談 {who}</p>
      <h1 style={{ fontSize: 22 }}>{heading}</h1>
      {info.note && <p style={{ lineHeight: 1.9, color: "#334155" }}>{info.note}</p>}
      <p style={{ lineHeight: 1.9, color: "#334155" }}>
        {info.methodLabel ? `${info.methodLabel}、` : ""}おおよそ {info.slotMinutes ?? 60} 分を考えています。
        下の空いている時間から、ご都合のよいものを 3 つまで選んで送ってください。
      </p>

      {options && options.length === 0 && (
        <p style={{ padding: "12px 16px", background: "#fef9c3", borderRadius: 8, lineHeight: 1.8 }}>
          あいにく、いまお選びいただける時間がありません。お手数ですが、リンクを送ってくれた方に直接ご連絡ください。
        </p>
      )}

      {[...byDate.entries()].map(([k, slots]) => (
        <section key={k} style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 15, color: "#334155", margin: "0 0 8px" }}>{dayLabel(new Date(slots[0]!.start))}</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {slots.map((o) => {
              const on = chosen.includes(o.start);
              return (
                <button
                  key={o.start}
                  onClick={() => toggle(o.start)}
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

      {chosen.length > 0 && (
        <section style={{ marginTop: 24, padding: "16px", border: "1px solid #e2e8f0", borderRadius: 12 }}>
          <p style={{ margin: "0 0 8px", color: "#334155" }}>
            選んだ時間: {options!.filter((o) => chosen.includes(o.start)).map((o) => `${dayLabel(new Date(o.start))} ${timeLabel(new Date(o.start))}`).join("、")}
          </p>
          <label style={{ display: "block", margin: "8px 0" }}>
            お名前 (必ず入れてください)
            <input style={input} value={guestName} onChange={(e) => setGuestName(e.target.value)} aria-label="お名前" />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            ご連絡先 (任意。メールやお電話など、返事を受け取りやすいもの)
            <input style={input} value={guestContact} onChange={(e) => setGuestContact(e.target.value)} aria-label="ご連絡先" />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            ひとこと (任意)
            <textarea style={input} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="ひとこと" />
          </label>
          {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
          <button style={btn()} disabled={busy || !guestName.trim()} onClick={() => void submit()}>
            {busy ? "お送りしています…" : "この内容で送る"}
          </button>
        </section>
      )}
    </main>
  );
}
