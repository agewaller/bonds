"use client";
// 日程調整の公開ページ (共有リンクの飛び先)。アカウント不要。
// timeshare のインターフェイスを踏襲: 空き時間を週間カレンダーで見せ、同じ URL に
// 入った相手が自分の予定表 (ICS) を重ねると、全員に共通の空き時間だけが表示される。
// 予定の中身は互いに一切見えない (見えるのは空き枠だけ)。
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ShareSlotCalendar from "../../../components/ShareSlotCalendar";

type ShareInfo = {
  locked: boolean;
  title: string;
  displayName: string;
  methodLabel?: string;
  note?: string;
  slotMinutes?: number;
  participants?: string[];
  googleReady?: boolean;
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
  const [basis, setBasis] = useState<"owner" | "common">("owner");
  const [participants, setParticipants] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]); // start ISO の配列 (最大 3)
  const [guestName, setGuestName] = useState("");
  const [guestContact, setGuestContact] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // あなたの予定表の重ね合わせ
  const [showOverlay, setShowOverlay] = useState(false);
  const [showIcs, setShowIcs] = useState(false);
  const [pName, setPName] = useState("");
  const [pIcsUrl, setPIcsUrl] = useState("");
  const [pIcsText, setPIcsText] = useState("");
  const [overlayError, setOverlayError] = useState("");
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [myKey, setMyKey] = useState("");

  const storageKey = `bonds_share_participant_${key}`;

  const loadInfoAndSlots = useCallback(
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
        if (r2.ok) {
          const s = (await r2.json()) as { options: IsoSlot[]; participants: string[]; basis: "owner" | "common" };
          setOptions(s.options);
          setParticipants(s.participants ?? []);
          setBasis(s.basis ?? "owner");
        }
      }
    },
    [key],
  );

  useEffect(() => {
    try {
      setMyKey(window.localStorage.getItem(storageKey) ?? "");
    } catch {
      // 記憶できない環境でも重ね合わせ自体は使える (更新・取り消しができないだけ)
    }
    // Google 同意からの戻り (?google=joined&participant=…) を受け取る
    try {
      const q = new URLSearchParams(window.location.search);
      const g = q.get("google");
      if (g === "joined") {
        const pk = q.get("participant") ?? "";
        if (pk) {
          setMyKey(pk);
          try {
            window.localStorage.setItem(storageKey, pk);
          } catch {
            // 保存できなくても表示は共通の空きに切り替わる
          }
        }
      } else if (g === "full") {
        setShowOverlay(true);
        setOverlayError("重ねられる人数がいっぱいになっています。リンクを送ってくれた方にご相談ください");
      } else if (g === "error") {
        setShowOverlay(true);
        setOverlayError("Google との連携がうまくいきませんでした。もう一度お試しいただくか、下の予定表の貼り付けをお使いください");
      }
      if (g) window.history.replaceState(null, "", window.location.pathname);
    } catch {
      // URL を読めない環境でもページ自体は使える
    }
    void loadInfoAndSlots("");
  }, [loadInfoAndSlots, storageKey]);

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
    await loadInfoAndSlots(p);
  };

  const toggle = (start: string) => {
    setChosen((cur) => (cur.includes(start) ? cur.filter((x) => x !== start) : cur.length >= 3 ? cur : [...cur, start]));
  };

  // 自分の予定表を重ねる (ICS の URL か貼り付け)。以後は共通の空きだけが表示される
  const joinOverlay = async () => {
    setOverlayError("");
    if (!pName.trim() && !myKey) {
      setOverlayError("お名前を入れてください");
      return;
    }
    if (!pIcsUrl.trim() && !pIcsText.trim()) {
      setOverlayError("予定表のアドレスを入れるか、予定表ファイルの中身を貼り付けてください");
      return;
    }
    setOverlayBusy(true);
    const payload: Record<string, string> = { proof };
    if (pIcsUrl.trim()) payload.icsUrl = pIcsUrl.trim();
    else payload.ics = pIcsText;
    let res: Response;
    if (myKey) {
      res = await fetch(`/api/bff/public/schedule/${key}/participants/${myKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      payload.name = pName;
      res = await fetch(`/api/bff/public/schedule/${key}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    const body = (await res.json().catch(() => ({}))) as { detail?: string; participantKey?: string };
    setOverlayBusy(false);
    if (!res.ok) {
      setOverlayError(body.detail ?? "重ねられませんでした。時間をおいてお試しください");
      return;
    }
    if (body.participantKey) {
      setMyKey(body.participantKey);
      try {
        window.localStorage.setItem(storageKey, body.participantKey);
      } catch {
        // 保存できなくても表示は共通の空きに切り替わる
      }
    }
    setShowOverlay(false);
    setChosen([]);
    await loadInfoAndSlots(proof);
  };

  // 基本の入り口: Google に一度だけ空き情報 (freeBusy) を聞いて重ねる。予定の中身は見ない・鍵も保存しない
  const connectGoogle = async () => {
    setOverlayError("");
    setOverlayBusy(true);
    const q = new URLSearchParams();
    if (proof) q.set("proof", proof);
    if (myKey) q.set("participantKey", myKey);
    const res = await fetch(`/api/bff/public/schedule/${key}/google-auth-url?${q.toString()}`);
    const body = (await res.json().catch(() => ({}))) as { url?: string; detail?: string };
    if (!res.ok || !body.url) {
      setOverlayBusy(false);
      setOverlayError(body.detail ?? "Google との連携がいま使えません。下の予定表の貼り付けをお使いください");
      return;
    }
    window.location.href = body.url;
  };

  const leaveOverlay = async () => {
    if (!myKey) return;
    setOverlayBusy(true);
    await fetch(`/api/bff/public/schedule/${key}/participants/${myKey}`, { method: "DELETE" }).catch(() => null);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // 消せなくても続行できる
    }
    setMyKey("");
    setOverlayBusy(false);
    setChosen([]);
    await loadInfoAndSlots(proof);
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
        await loadInfoAndSlots(proof);
      }
      return;
    }
    setDone(true);
  };

  if (gone) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>このページは終了したか、見つかりませんでした。お手数ですが、リンクを送ってくれた方にご確認ください。</p>
      </main>
    );
  }
  if (!info) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>読み込んでいます…</p>
      </main>
    );
  }

  const heading = info.title || "お会いする日時のご相談";
  const who = info.displayName ? `${info.displayName} より` : "";

  if (done) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
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
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
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

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <p style={{ color: "#94a3b8", fontSize: 13, letterSpacing: 1 }}>日程のご相談 {who}</p>
      <h1 style={{ fontSize: 22 }}>{heading}</h1>
      {info.note && <p style={{ lineHeight: 1.9, color: "#334155" }}>{info.note}</p>}
      <p style={{ lineHeight: 1.9, color: "#334155" }}>
        {info.methodLabel ? `${info.methodLabel}、` : ""}おおよそ {info.slotMinutes ?? 60} 分を考えています。
        空いている時間から、ご都合のよいものを 3 つまで選んで送ってください。
      </p>

      {basis === "common" && participants.length > 0 && (
        <p style={{ padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, color: "#166534", lineHeight: 1.8 }}>
          {participants.join("さん、")}さんの予定表と重ねた、みんなに共通の空き時間を表示しています。
        </p>
      )}

      {/* timeshare 踏襲: 自分の予定表を重ねて、共通の空きだけにする */}
      <section style={{ marginTop: 12, border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 16px" }}>
        <button
          onClick={() => setShowOverlay((v) => !v)}
          style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0, fontSize: 14, fontWeight: 600 }}
        >
          {myKey ? "あなたの予定表を重ねています (更新・取り消し)" : "あなたの予定表を重ねて、おたがいに空いている時間だけにする"}
        </button>
        {showOverlay && (
          <div style={{ marginTop: 8 }}>
            <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.8, margin: "0 0 8px" }}>
              あなたの空き時間と重ねると、おたがいに空いている時間だけが表示されます。
              見るのは「空いているかどうか」だけで、予定の中身がこのページや相手に伝わることはありません。
            </p>
            {overlayError && <p role="alert" style={{ color: "#b91c1c" }}>{overlayError}</p>}
            {info.googleReady && (
              <div style={{ margin: "8px 0" }}>
                <button style={btn()} disabled={overlayBusy} onClick={() => void connectGoogle()}>
                  {overlayBusy ? "つないでいます…" : "Google でカレンダーをつなぐ"}
                </button>
                <p style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.7, margin: "6px 0 0" }}>
                  Google の画面で確認を押すだけで重なります。合い鍵は預かりません。
                </p>
              </div>
            )}
            {myKey && (
              <div style={{ margin: "8px 0" }}>
                <button style={{ ...btn(false), color: "#b91c1c" }} disabled={overlayBusy} onClick={() => void leaveOverlay()}>
                  重ねるのをやめる (あなたの分を消す)
                </button>
              </div>
            )}
            {/* 代替: Google をお使いでない方向けの ICS (アドレス or 貼り付け) */}
            <button
              onClick={() => setShowIcs((v) => !v)}
              style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: 0, fontSize: 13, textDecoration: "underline" }}
            >
              Google をお使いでない方はこちら (予定表のアドレスや貼り付け)
            </button>
            {(showIcs || !info.googleReady) && (
              <div style={{ marginTop: 8 }}>
                {!myKey && (
                  <label style={{ display: "block", margin: "8px 0" }}>
                    お名前
                    <input style={input} value={pName} onChange={(e) => setPName(e.target.value)} aria-label="重ねる方のお名前" />
                  </label>
                )}
                <label style={{ display: "block", margin: "8px 0" }}>
                  予定表のアドレス (https で始まる ICS)
                  <input style={input} value={pIcsUrl} onChange={(e) => setPIcsUrl(e.target.value)} aria-label="予定表のアドレス" placeholder="https://calendar.google.com/.../basic.ics" />
                </label>
                <label style={{ display: "block", margin: "8px 0" }}>
                  またはカレンダーから書き出した .ics ファイルの中身を貼り付け
                  <textarea style={input} rows={3} value={pIcsText} onChange={(e) => setPIcsText(e.target.value)} aria-label="予定表の貼り付け" placeholder="BEGIN:VCALENDAR …" />
                </label>
                <button style={btn(false)} disabled={overlayBusy} onClick={() => void joinOverlay()}>
                  {overlayBusy ? "重ねています…" : myKey ? "予定表を入れ直す" : "この予定表を重ねる"}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {options && options.length === 0 && (
        <p style={{ padding: "12px 16px", background: "#fef9c3", borderRadius: 8, lineHeight: 1.8, marginTop: 12 }}>
          {basis === "common"
            ? "あいにく、みんなに共通の空き時間が見つかりませんでした。お手数ですが、リンクを送ってくれた方に直接ご連絡ください。"
            : "あいにく、いまお選びいただける時間がありません。お手数ですが、リンクを送ってくれた方に直接ご連絡ください。"}
        </p>
      )}

      {/* 週間カレンダー (timeshare と同じ FullCalendar)。色つきのマスが空き、タップで候補に選ぶ */}
      {options && options.length > 0 && (
        <>
          <p style={{ color: "#64748b", fontSize: 13, margin: "12px 0 0" }}>
            色のついた時間が{basis === "common" ? "みんなの共通の" : ""}空きです。前後の週は矢印で動かせます。
          </p>
          <ShareSlotCalendar options={options} chosen={chosen} onToggle={toggle} common={basis === "common"} maxChoices={3} />
        </>
      )}

      {chosen.length > 0 && options && (
        <section style={{ marginTop: 24, padding: "16px", border: "1px solid #e2e8f0", borderRadius: 12 }}>
          <p style={{ margin: "0 0 8px", color: "#334155" }}>
            選んだ時間: {options.filter((o) => chosen.includes(o.start)).map((o) => `${dayLabel(new Date(o.start))} ${timeLabel(new Date(o.start))}`).join("、")}
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
