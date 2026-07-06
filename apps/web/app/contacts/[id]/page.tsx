"use client";
// 連絡先詳細 — 把握 (プロフィール・価値観下書き) / 打ち手 (面談候補・文面候補) /
// 実行 (承認 → 送信) / 検証 (やりとりの記録) を一画面に。
// 外に出る行動は必ず「下書き → 承認 → 送信」(CLAUDE.md 自律性の段階)。
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/client-api";
import Link from "next/link";
import { useParams } from "next/navigation";

type Contact = {
  id: string;
  name: string;
  distance: number;
  relationship: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  personalProfile: string | null;
  valuesProfile: string | null;
  notes: string | null;
};
type Interaction = { id: string; type: string; occurredAt: string; notes: string | null };
type Gift = { id: string; occasion: string; direction: string; item: string; givenAt: string };
type LinkedSubject = { linkId: string; slug: string; name: string };
type Candidate = { subject: string; body: string; tone: string; aim: string };
type Slot = { start: string; end: string };

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

function fmtSlot(s: Slot) {
  const st = new Date(s.start);
  const en = new Date(s.end);
  return `${st.getMonth() + 1}月${st.getDate()}日 ${st.getHours()}:${String(st.getMinutes()).padStart(2, "0")} から ${en.getHours()}:${String(en.getMinutes()).padStart(2, "0")}`;
}

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [linkedSubjects, setLinkedSubjects] = useState<LinkedSubject[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [giftItem, setGiftItem] = useState("");
  const [giftOccasion, setGiftOccasion] = useState("other");
  const [channel, setChannel] = useState("email");
  const [sendAt, setSendAt] = useState("");
  const [linkSlug, setLinkSlug] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [theirIcsUrl, setTheirIcsUrl] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [draftId, setDraftId] = useState("");
  const [chosen, setChosen] = useState(0);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [sentInfo, setSentInfo] = useState("");
  const [purpose, setPurpose] = useState("keepup");
  const [points, setPoints] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch(`contacts/${id}`);
    if (!res.ok) {
      if (res.status === 404) setNotFound(true);
      return;
    }
    const body = await res.json();
    setContact(body.contact);
    setInteractions(body.interactions);
    setGifts(body.gifts ?? []);
    setLinkedSubjects(body.linkedSubjects ?? []);
    setForm({
      personalProfile: body.contact.personalProfile ?? "",
      valuesProfile: body.contact.valuesProfile ?? "",
      notes: body.contact.notes ?? "",
      email: body.contact.email ?? "",
    });
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (path: string, init: RequestInit, okMsg?: string) => {
    setBusy(path);
    setError("");
    try {
      const res = await apiFetch(`${path}`, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail ?? "うまくいきませんでした。しばらくしてからお試しください");
        return null;
      }
      if (okMsg) setNotice(okMsg);
      return body;
    } finally {
      setBusy("");
    }
  };

  const saveProfile = async () => {
    if (!contact) return;
    const body = await call(
      `contacts/${contact.id}`,
      { method: "PUT", body: JSON.stringify({ name: contact.name, distance: contact.distance, ...form }) },
      "保存しました",
    );
    if (body) await load();
  };

  const enrichValues = async () => {
    if (!contact) return;
    const body = await call(`contacts/${contact.id}/enrich-values`, { method: "POST", body: "{}" });
    if (body?.draft) {
      setForm((f) => ({ ...f, valuesProfile: body.draft }));
      setNotice("下書きを作りました。内容を確かめて、直してから保存してください");
    }
  };

  const loadSlots = async () => {
    if (!contact) return;
    const body = await call(`contacts/${contact.id}/meeting-slots?days=14`, { method: "GET" });
    if (body) {
      setSlots(body.proposals);
      if (!body.hasMyCalendar) setNotice("ご自身の予定が未登録のため、営業時間すべてが候補になっています");
    }
  };

  const makeDraft = async () => {
    if (!contact) return;
    const body = await call(
      "outreach/draft",
      { method: "POST", body: JSON.stringify({ contactId: contact.id, purpose, points, channel }) },
      "文面の候補を作りました",
    );
    if (body?.candidates) {
      setCandidates(body.candidates);
      setDraftId(body.id);
      setChosen(0);
      setEditSubject(body.candidates[0].subject);
      setEditBody(body.candidates[0].body);
      setSentInfo("");
    }
  };

  const approveAndSend = async () => {
    if (!draftId) return;
    const approved = await call(`outreach/${draftId}/approve`, {
      method: "POST",
      body: JSON.stringify({ subject: editSubject, body: editBody }),
    });
    if (!approved) return;
    if (channel !== "email") {
      // メール以外は別手段で届けるため「手配済み」として記録する
      const done = await call(`outreach/${draftId}/mark-sent`, {
        method: "POST",
        body: JSON.stringify({ item: channel === "gift" ? points || editSubject : undefined }),
      });
      if (done) {
        setSentInfo("お手元で届けたら完了です。やりとりの記録に残しました");
        setCandidates(null);
        setDraftId("");
        await load();
      }
      return;
    }
    if (sendAt) {
      const scheduled = await call(`outreach/${draftId}/schedule`, {
        method: "POST",
        body: JSON.stringify({ sendAt: new Date(sendAt).toISOString() }),
      });
      if (scheduled) {
        setSentInfo("予約しました。時間になったら自動でお送りします");
        setCandidates(null);
        setDraftId("");
      }
      return;
    }
    const sent = await call(`outreach/${draftId}/send`, { method: "POST", body: "{}" });
    if (sent) {
      setSentInfo("お送りしました。やりとりの記録にも残しています");
      setCandidates(null);
      setDraftId("");
      await load();
    }
  };

  if (notFound) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>この方のページが見つかりませんでした。</p>
        <p><Link href="/contacts" style={{ color: "#2563eb" }}>連絡帳へ戻る</Link></p>
      </main>
    );
  }
  if (!contact) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>読み込んでいます…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <p>
        <Link href="/contacts" style={{ color: "#2563eb" }}>連絡帳へ戻る</Link>
      </p>
      <h1 style={{ fontSize: 24 }}>{contact.name}</h1>
      <p style={{ color: "#64748b" }}>
        {contact.company} {contact.title}
      </p>

      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>
      )}

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18 }}>この方のこと</h2>
        <label style={{ display: "block", margin: "8px 0" }}>
          メールアドレス
          <input style={input} value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label style={{ display: "block", margin: "8px 0" }}>
          近況・状況 (健康・ご家族・お仕事・悩み・夢など)
          <textarea style={input} rows={3} value={form.personalProfile ?? ""} onChange={(e) => setForm({ ...form, personalProfile: e.target.value })} />
        </label>
        <label style={{ display: "block", margin: "8px 0" }}>
          大切にしていること (価値観・目標)
          <textarea style={input} rows={3} value={form.valuesProfile ?? ""} onChange={(e) => setForm({ ...form, valuesProfile: e.target.value })} />
        </label>
        <label style={{ display: "block", margin: "8px 0" }}>
          メモ
          <textarea style={input} rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btn()} onClick={() => void saveProfile()} disabled={!!busy}>保存する</button>
          <button style={btn(false)} onClick={() => void enrichValues()} disabled={!!busy}>
            記録から「大切にしていること」の下書きを作る
          </button>
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18 }}>お会いする日を探す</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            style={{ ...input, flex: 1, width: "auto" }}
            placeholder="この方の予定表アドレス (任意・https://...ics)"
            aria-label="相手の予定表アドレス"
            value={theirIcsUrl}
            onChange={(e) => setTheirIcsUrl(e.target.value)}
          />
          <button
            style={btn(false)}
            disabled={!!busy || !theirIcsUrl.trim()}
            onClick={async () => {
              const body = await call(`contacts/${contact.id}/busy`, {
                method: "PUT",
                body: JSON.stringify({ icsUrl: theirIcsUrl }),
              }, "この方の予定表をつなぎました");
              if (body) setTheirIcsUrl("");
            }}
          >
            予定表をつなぐ
          </button>
        </div>
        <button style={btn(false)} onClick={() => void loadSlots()} disabled={!!busy}>
          おたがいの空きから候補を出す
        </button>
        {slots && (
          <ul>
            {slots.map((s, i) => (
              <li key={i}>
                {fmtSlot(s)}{" "}
                <a
                  href={`/api/bff/contacts/${contact.id}/meeting-invite?start=${encodeURIComponent(s.start)}&end=${encodeURIComponent(s.end)}`}
                  style={{ color: "#2563eb", marginLeft: 8 }}
                >
                  カレンダーに入れる
                </a>
              </li>
            ))}
            {slots.length === 0 && <li>この 2 週間では重なる空きが見つかりませんでした</li>}
          </ul>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18 }}>お便りを送る</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="届け方" style={{ ...input, width: "auto" }}>
            <option value="email">メール</option>
            <option value="gift">贈り物に添える</option>
            <option value="nengajo">年賀状・挨拶状</option>
            <option value="meeting_invite">面談の打診</option>
          </select>
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="目的" style={{ ...input, width: "auto" }}>
            <option value="keepup">近況伺い</option>
            <option value="birthday">お誕生日</option>
            <option value="thanks">お礼</option>
            <option value="meeting">お会いしたい</option>
            <option value="contribution">力になりたい</option>
            <option value="repair">関係の修復</option>
          </select>
          <input
            style={{ ...input, flex: 1 }}
            placeholder="伝えたいこと (任意)"
            aria-label="伝えたいこと"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
          <button style={btn()} onClick={() => void makeDraft()} disabled={!!busy}>
            {busy === "outreach/draft" ? "考えています…" : "文面の候補を作る"}
          </button>
        </div>

        {candidates && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {candidates.map((c, i) => (
                <button
                  key={i}
                  style={{ ...btn(i === chosen), fontSize: 13 }}
                  onClick={() => {
                    setChosen(i);
                    setEditSubject(c.subject);
                    setEditBody(c.body);
                  }}
                >
                  案{i + 1} {c.tone}
                </button>
              ))}
            </div>
            <label style={{ display: "block", margin: "8px 0" }}>
              件名
              <input style={input} value={editSubject} onChange={(e) => setEditSubject(e.target.value)} aria-label="件名" />
            </label>
            <label style={{ display: "block", margin: "8px 0" }}>
              本文 (自由に直してください)
              <textarea style={input} rows={8} value={editBody} onChange={(e) => setEditBody(e.target.value)} aria-label="本文" />
            </label>
            {channel === "email" && (
              <label style={{ display: "block", margin: "8px 0", color: "#64748b", fontSize: 14 }}>
                送る時間を予約する (空欄ならすぐに送ります)
                <input
                  type="datetime-local"
                  value={sendAt}
                  onChange={(e) => setSendAt(e.target.value)}
                  aria-label="送信予約"
                  style={{ ...input, width: "auto", marginLeft: 8 }}
                />
              </label>
            )}
            <button style={btn()} onClick={() => void approveAndSend()} disabled={!!busy}>
              {channel === "email" ? (sendAt ? "この内容で承認して予約する" : "この内容で承認して送る") : "この内容で承認する (お手元で届ける)"}
            </button>
            <p style={{ color: "#64748b", fontSize: 13 }}>
              承認いただくまで送信されません。送った記録はやりとりに残ります。
            </p>
          </div>
        )}
        {sentInfo && <p style={{ color: "#166534" }}>{sentInfo}</p>}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18 }}>贈り物の記録</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <select value={giftOccasion} onChange={(e) => setGiftOccasion(e.target.value)} aria-label="機会" style={{ ...input, width: "auto" }}>
            <option value="birthday">お誕生日</option>
            <option value="new_year">お年賀</option>
            <option value="celebration">お祝い</option>
            <option value="thanks">お礼</option>
            <option value="other">その他</option>
          </select>
          <input
            style={{ ...input, flex: 1 }}
            placeholder="何を贈りましたか (例: 季節の花)"
            aria-label="贈り物"
            value={giftItem}
            onChange={(e) => setGiftItem(e.target.value)}
          />
          <button
            style={btn(false)}
            disabled={!!busy || !giftItem.trim()}
            onClick={async () => {
              const body = await call(`contacts/${contact.id}/gifts`, {
                method: "POST",
                body: JSON.stringify({ occasion: giftOccasion, item: giftItem }),
              }, "贈り物を記録しました");
              if (body) {
                setGiftItem("");
                await load();
              }
            }}
          >
            記録する
          </button>
        </div>
        <ul>
          {gifts.map((g) => (
            <li key={g.id}>
              {new Date(g.givenAt).toLocaleDateString("ja-JP")} {g.direction === "outbound" ? "贈った" : "いただいた"}: {g.item}
            </li>
          ))}
          {gifts.length === 0 && <li style={{ color: "#64748b" }}>まだ記録がありません</li>}
        </ul>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18 }}>公人プロフィール</h2>
        {linkedSubjects.length > 0 ? (
          <ul>
            {linkedSubjects.map((l) => (
              <li key={l.linkId}>
                <Link href={`/subjects/${l.slug}`} style={{ color: "#2563eb" }}>{l.name} の評価を見る</Link>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...input, flex: 1 }}
              placeholder="評価対象の ID (人物評価ページの URL 末尾)"
              aria-label="評価対象ID"
              value={linkSlug}
              onChange={(e) => setLinkSlug(e.target.value)}
            />
            <button
              style={btn(false)}
              disabled={!!busy || !linkSlug.trim()}
              onClick={async () => {
                const body = await call(`contacts/${contact.id}/links`, {
                  method: "POST",
                  body: JSON.stringify({ slug: linkSlug.trim() }),
                }, "結びつけました");
                if (body) {
                  setLinkSlug("");
                  await load();
                }
              }}
            >
              結びつける
            </button>
          </div>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18 }}>これまでのやりとり</h2>
        <ul>
          {interactions.map((i) => (
            <li key={i.id}>
              {new Date(i.occurredAt).toLocaleDateString("ja-JP")} {i.type}
              {i.notes ? ` — ${i.notes}` : ""}
            </li>
          ))}
          {interactions.length === 0 && <li style={{ color: "#64748b" }}>まだ記録がありません</li>}
        </ul>
      </section>
    </main>
  );
}
