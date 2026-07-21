"use client";
// 日程調整の公開ページ (共有リンクの飛び先)。アカウント不要。
// timeshare のインターフェイスを踏襲: 空き時間を週間カレンダーで見せ、同じ URL に
// 入った相手が自分の予定表 (ICS) を重ねると、全員に共通の空き時間だけが表示される。
// 予定の中身は互いに一切見えない (見えるのは空き枠だけ)。
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ShareSlotCalendar from "../../../components/ShareSlotCalendar";
import { t, currentLocale, type Locale } from "../../../lib/i18n";

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

const DAY7 = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const dayLabel = (d: Date, locale: Locale) =>
  t("m_date_md", locale)
    .replace("{m}", String(d.getMonth() + 1))
    .replace("{d}", String(d.getDate()))
    .replace("{w}", t(`m_wd_${DAY7[d.getDay()]}`, locale));
const timeLabel = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

export default function PublicSchedulePage() {
  // cookie はクライアントでしか読めないため、初回描画後に反映する
  const [locale, setLoc] = useState<Locale>("ja");
  useEffect(() => setLoc(currentLocale()), []);
  const T = (key: string) => t(key, locale);
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
        setOverlayError(t("m_s_full"));
      } else if (g === "error") {
        setShowOverlay(true);
        setOverlayError(t("m_s_gerr"));
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
      setError((body as { detail?: string }).detail ?? t("m_s_wrong_pw"));
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
      setOverlayError(t("m_s_need_name"));
      return;
    }
    if (!pIcsUrl.trim() && !pIcsText.trim()) {
      setOverlayError(t("m_s_need_ics"));
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
      setOverlayError(body.detail ?? t("m_s_join_fail"));
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
      setOverlayError(body.detail ?? t("m_s_gunavail"));
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
      setError((body as { detail?: string }).detail ?? t("m_s_submit_fail"));
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
        <p>{T("m_s_gone")}</p>
      </main>
    );
  }
  if (!info) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>{T("m_loading")}</p>
      </main>
    );
  }

  const heading = info.title || T("m_share_default_title");
  const who = info.displayName ? `${T("m_s_who_pre")}${info.displayName}${T("m_s_who_post")}` : "";

  if (done) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <h1 style={{ fontSize: 22 }}>{heading}</h1>
        <div style={{ marginTop: 24, padding: "20px 16px", background: "#f0fdf4", borderRadius: 12 }}>
          <p style={{ margin: 0, lineHeight: 1.9 }}>
            {T("m_s_done")}
          </p>
        </div>
      </main>
    );
  }

  if (info.locked) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p style={{ color: "#94a3b8", fontSize: 13, letterSpacing: 1 }}>{T("m_s_label")} {who}</p>
        <h1 style={{ fontSize: 22 }}>{heading}</h1>
        <p style={{ lineHeight: 1.9 }}>{T("m_s_locked")}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            style={{ ...input, flex: 1 }}
            type="password"
            aria-label={T("m_pw_aria")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void unlock()}
          />
          <button style={btn()} onClick={() => void unlock()}>{T("m_s_open_btn")}</button>
        </div>
        {error && <p role="alert" style={{ color: "#b91c1c", marginTop: 8 }}>{error}</p>}
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <p style={{ color: "#94a3b8", fontSize: 13, letterSpacing: 1 }}>{T("m_s_label")} {who}</p>
      <h1 style={{ fontSize: 22 }}>{heading}</h1>
      {info.note && <p style={{ lineHeight: 1.9, color: "#334155" }}>{info.note}</p>}
      <p style={{ lineHeight: 1.9, color: "#334155" }}>
        {info.methodLabel ? `${info.methodLabel}、` : ""}{T("m_s_about_p1")}{info.slotMinutes ?? 60}{T("m_s_about_p2")}
      </p>

      {basis === "common" && participants.length > 0 && (
        <p style={{ padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, color: "#166534", lineHeight: 1.8 }}>
          {participants.join(T("m_san_sep"))}{T("m_s_common_suffix")}
        </p>
      )}

      {/* timeshare 踏襲: 自分の予定表を重ねて、共通の空きだけにする */}
      <section style={{ marginTop: 12, border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 16px" }}>
        <button
          onClick={() => setShowOverlay((v) => !v)}
          style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0, fontSize: 14, fontWeight: 600 }}
        >
          {myKey ? T("m_s_overlay_on") : T("m_s_overlay_off")}
        </button>
        {showOverlay && (
          <div style={{ marginTop: 8 }}>
            <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.8, margin: "0 0 8px" }}>
              {T("m_s_overlay_desc")}
            </p>
            {overlayError && <p role="alert" style={{ color: "#b91c1c" }}>{overlayError}</p>}
            {info.googleReady && (
              <div style={{ margin: "8px 0" }}>
                <button style={btn()} disabled={overlayBusy} onClick={() => void connectGoogle()}>
                  {overlayBusy ? T("m_s_connecting") : T("m_s_gconnect")}
                </button>
                <p style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.7, margin: "6px 0 0" }}>
                  {T("m_s_gnote")}
                </p>
              </div>
            )}
            {myKey && (
              <div style={{ margin: "8px 0" }}>
                <button style={{ ...btn(false), color: "#b91c1c" }} disabled={overlayBusy} onClick={() => void leaveOverlay()}>
                  {T("m_s_leave")}
                </button>
              </div>
            )}
            {/* 代替: Google をお使いでない方向けの ICS (アドレス or 貼り付け) */}
            <button
              onClick={() => setShowIcs((v) => !v)}
              style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: 0, fontSize: 13, textDecoration: "underline" }}
            >
              {T("m_s_ics_toggle")}
            </button>
            {(showIcs || !info.googleReady) && (
              <div style={{ marginTop: 8 }}>
                {!myKey && (
                  <label style={{ display: "block", margin: "8px 0" }}>
                    {T("name_placeholder")}
                    <input style={input} value={pName} onChange={(e) => setPName(e.target.value)} aria-label={T("m_s_pname_aria")} />
                  </label>
                )}
                <label style={{ display: "block", margin: "8px 0" }}>
                  {T("m_ics_url_label")}
                  <input style={input} value={pIcsUrl} onChange={(e) => setPIcsUrl(e.target.value)} aria-label={T("m_ics_url_aria")} placeholder="https://calendar.google.com/.../basic.ics" />
                </label>
                <label style={{ display: "block", margin: "8px 0" }}>
                  {T("m_s_ics_paste_label")}
                  <textarea style={input} rows={3} value={pIcsText} onChange={(e) => setPIcsText(e.target.value)} aria-label={T("m_s_ics_paste_aria")} placeholder="BEGIN:VCALENDAR …" />
                </label>
                <button style={btn(false)} disabled={overlayBusy} onClick={() => void joinOverlay()}>
                  {overlayBusy ? T("m_s_joining") : myKey ? T("m_s_rejoin") : T("m_s_join")}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {options && options.length === 0 && (
        <p style={{ padding: "12px 16px", background: "#fef9c3", borderRadius: 8, lineHeight: 1.8, marginTop: 12 }}>
          {basis === "common" ? T("m_s_no_common") : T("m_s_no_slots")}
        </p>
      )}

      {/* 週間カレンダー (timeshare と同じ FullCalendar)。色つきのマスが空き、タップで候補に選ぶ */}
      {options && options.length > 0 && (
        <>
          <p style={{ color: "#64748b", fontSize: 13, margin: "12px 0 0" }}>
            {T("m_s_hint_p1")}{basis === "common" ? T("m_s_hint_common") : ""}{T("m_s_hint_p2")}
          </p>
          <ShareSlotCalendar options={options} chosen={chosen} onToggle={toggle} common={basis === "common"} maxChoices={3} />
        </>
      )}

      {chosen.length > 0 && options && (
        <section style={{ marginTop: 24, padding: "16px", border: "1px solid #e2e8f0", borderRadius: 12 }}>
          <p style={{ margin: "0 0 8px", color: "#334155" }}>
            {T("m_s_chosen_prefix")}{options.filter((o) => chosen.includes(o.start)).map((o) => `${dayLabel(new Date(o.start), locale)} ${timeLabel(new Date(o.start))}`).join(T("m_list_sep"))}
          </p>
          <label style={{ display: "block", margin: "8px 0" }}>
            {T("m_guest_name_label")}
            <input style={input} value={guestName} onChange={(e) => setGuestName(e.target.value)} aria-label={T("name_placeholder")} />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            {T("m_s_contact_label")}
            <input style={input} value={guestContact} onChange={(e) => setGuestContact(e.target.value)} aria-label={T("m_guest_contact_aria")} />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            {T("m_s_msg_label")}
            <textarea style={input} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} aria-label={T("m_s_msg_aria")} />
          </label>
          {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
          <button style={btn()} disabled={busy || !guestName.trim()} onClick={() => void submit()}>
            {busy ? T("m_s_sending") : T("m_s_send_btn")}
          </button>
        </section>
      )}
    </main>
  );
}
