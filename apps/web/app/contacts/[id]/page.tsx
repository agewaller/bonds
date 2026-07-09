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
  profileDigest: string | null;
  profileDigestAt: string | null;
  profileFacets: string | null;
  profileFacetsAt: string | null;
};
type Facets = {
  summary?: string; contact?: string; status?: string; work?: string; family?: string; health?: string; values?: string;
  skills?: string[]; concerns?: string[]; goals?: string[]; likes?: string[]; cautions?: string[]; opportunities?: string[];
};
// 論点の表示順とラベル (連絡先・状況・スキル・悩み・家族構成 … を一望できるように)
const FACET_TEXT: { key: keyof Facets; label: string }[] = [
  { key: "contact", label: "連絡の取り方" },
  { key: "status", label: "いまの状況" },
  { key: "work", label: "仕事・役割" },
  { key: "family", label: "家族・大切な人" },
  { key: "health", label: "健康で気にかけること" },
  { key: "values", label: "価値観" },
];
const FACET_LIST: { key: keyof Facets; label: string }[] = [
  { key: "skills", label: "得意なこと" },
  { key: "concerns", label: "悩み・課題" },
  { key: "goals", label: "目標・夢" },
  { key: "likes", label: "好きなもの・関心" },
  { key: "cautions", label: "気をつけたいこと" },
  { key: "opportunities", label: "こちらから貢献できそうなこと" },
];
type RelationshipScore = {
  distance: number;
  depth: number;
  potential: number;
  depthBand: string;
  potentialBand: string;
  reason: string;
};
type Playbook = {
  relationship: string;
  intersections: { area: string; point: string }[];
  actions: { title: string; detail: string; why: string }[];
  somethingNew: string;
  caution: string;
};
type Interaction = { id: string; type: string; occurredAt: string; notes: string | null };
type Gift = { id: string; occasion: string; direction: string; item: string; givenAt: string };
type Exchange = {
  id: string;
  kind: string;
  direction: string;
  title: string;
  value: number | null;
  status: string;
  dueAt: string | null;
  occurredAt: string;
};
type ExchangeLedger = {
  outboundCount: number;
  inboundCount: number;
  outboundValue: number;
  inboundValue: number;
  balance: number;
  openCount: number;
  needsReturn: boolean;
};
type LinkedSubject = { linkId: string; slug: string; name: string };
type Candidate = { subject: string; body: string; tone: string; aim: string };
type Slot = { start: string; end: string };

const SNS_LABEL: Record<string, string> = {
  x: "X (旧Twitter)",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  note: "note",
  youtube: "YouTube",
  tiktok: "TikTok",
  threads: "Threads",
  github: "GitHub",
  blog: "ブログ・ウェブサイト",
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

function fmtSlot(s: Slot) {
  const st = new Date(s.start);
  const en = new Date(s.end);
  return `${st.getMonth() + 1}月${st.getDate()}日 ${st.getHours()}:${String(st.getMinutes()).padStart(2, "0")} から ${en.getHours()}:${String(en.getMinutes()).padStart(2, "0")}`;
}

// 距離感 1〜5 のやさしいラベル (専門用語を避ける。65歳ペルソナ)。
const DISTANCE_LABEL: Record<number, string> = {
  1: "とても近い",
  2: "近い",
  3: "ほどよい",
  4: "ときどき",
  5: "たまに",
};

function ScoreTile({ label, value, suffix, caption }: { label: string; value: string; suffix: string; caption: string }) {
  return (
    <div style={{ flex: "1 1 120px", minWidth: 120, background: "#f8fafc", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ color: "#64748b", fontSize: 13 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 2, margin: "2px 0" }}>
        <span style={{ fontSize: 30, fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>{value}</span>
        <span style={{ color: "#94a3b8", fontSize: 14 }}>{suffix}</span>
      </div>
      {caption ? <div style={{ color: "#0891b2", fontSize: 13 }}>{caption}</div> : null}
    </div>
  );
}

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [linkedSubjects, setLinkedSubjects] = useState<LinkedSubject[]>([]);
  const [relScore, setRelScore] = useState<RelationshipScore | null>(null);
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [giftItem, setGiftItem] = useState("");
  const [giftOccasion, setGiftOccasion] = useState("other");
  const [giftDirection, setGiftDirection] = useState("outbound");
  const [giftBudget, setGiftBudget] = useState("");
  const [giftSuggestions, setGiftSuggestions] = useState<
    { idea: string; why: string; priceRange: string; howToFind: string }[] | null
  >(null);
  const [giftNote, setGiftNote] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [exLedger, setExLedger] = useState<ExchangeLedger | null>(null);
  const [exKind, setExKind] = useState("favor");
  const [exDirection, setExDirection] = useState("outbound");
  const [exTitle, setExTitle] = useState("");
  const [exValue, setExValue] = useState("");
  const [exStatus, setExStatus] = useState("done");
  const [exDueAt, setExDueAt] = useState("");
  const [snsAccounts, setSnsAccounts] = useState<{ platform: string; handle: string; url: string }[]>([]);
  const [snsInput, setSnsInput] = useState("");
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
    setRelScore(body.relationshipScore ?? null);
    const exRes = await apiFetch(`contacts/${id}/exchanges`);
    if (exRes.ok) {
      const exBody = await exRes.json();
      setExchanges(exBody.exchanges ?? []);
      setExLedger(exBody.ledger ?? null);
    }
    const snsRes = await apiFetch(`contacts/${id}/sns`);
    if (snsRes.ok) setSnsAccounts((await snsRes.json()).accounts ?? []);
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

  const refreshDigest = async (includePublic: boolean) => {
    if (!contact) return;
    const body = await call(`contacts/${contact.id}/refresh-digest`, {
      method: "POST",
      body: JSON.stringify({ includePublic }),
    });
    if (body?.digest) {
      setNotice(
        includePublic && !body.searched
          ? "記録からまとめ直しました (公開情報はいまは調べられませんでした)"
          : "この方のまとめを最新にしました",
      );
      await load();
    }
  };

  const generateFacets = async () => {
    if (!contact) return;
    const body = await call(`contacts/${contact.id}/facets`, { method: "POST", body: "{}" });
    if (body?.facets) {
      setNotice("この方の論点を整理しました");
      await load();
    }
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

      {relScore && (
        <section style={{ marginTop: 20, border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
          <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>この方との関係</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "10px 0" }}>
            <ScoreTile label="距離感" value={`${relScore.distance}`} suffix="/5" caption={DISTANCE_LABEL[relScore.distance] ?? ""} />
            <ScoreTile label="深さ" value={`${relScore.depth}`} suffix="/100" caption={relScore.depthBand} />
            <ScoreTile label="のびしろ" value={`${relScore.potential}`} suffix="/100" caption={relScore.potentialBand} />
          </div>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13, lineHeight: 1.8 }}>{relScore.reason}</p>
          <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 12, lineHeight: 1.7 }}>
            距離感はやりとりの多さと新しさから、深さはこれまでの積み重ねから、のびしろは把握できている強みや目標とまだ縮められる間合いから、
            記録をもとに自動で見立てています。記録が増えるほど確かになります。
          </p>
          <div style={{ marginTop: 12 }}>
            <button
              style={btn(true)}
              disabled={!!busy}
              onClick={async () => {
                const body = await call(`contacts/${contact.id}/playbook`, { method: "POST", body: JSON.stringify({}) });
                if (body?.actions || body?.relationship) setPlaybook(body);
              }}
            >
              {busy.includes("playbook") ? "考えています…" : "この方への対応を考える"}
            </button>
            <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 13 }}>
              二人の関係と、仕事や暮らしで噛み合いそうなところをふまえて、いまできる一手をご提案します。
            </p>
          </div>
          {playbook && (
            <div style={{ marginTop: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px" }}>
              {playbook.relationship && (
                <p style={{ margin: "0 0 10px", color: "#334155", lineHeight: 1.9 }}>{playbook.relationship}</p>
              )}
              {playbook.intersections.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>噛み合いそうなところ</div>
                  {playbook.intersections.map((x, i) => (
                    <p key={i} style={{ margin: "3px 0", fontSize: 14, color: "#334155", lineHeight: 1.8 }}>
                      {x.area ? <span style={{ color: "#0891b2", marginRight: 6 }}>{x.area}</span> : null}
                      {x.point}
                    </p>
                  ))}
                </div>
              )}
              {playbook.actions.length > 0 && (
                <div style={{ display: "grid", gap: 8 }}>
                  {playbook.actions.map((a, i) => (
                    <div key={i} style={{ background: "#f8fafc", borderRadius: 10, padding: "9px 12px" }}>
                      {a.title && <div style={{ fontWeight: 600 }}>{a.title}</div>}
                      {a.detail && <div style={{ fontSize: 14, marginTop: 2, lineHeight: 1.8 }}>{a.detail}</div>}
                      {a.why && <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{a.why}</div>}
                    </div>
                  ))}
                </div>
              )}
              {playbook.somethingNew && (
                <p style={{ marginTop: 10, fontSize: 14, color: "#334155", lineHeight: 1.8 }}>
                  もう一つ、まだ試していない関わり方として。{playbook.somethingNew}
                </p>
              )}
              {playbook.caution && (
                <p style={{ marginTop: 8, fontSize: 13, color: "#92400e", background: "#fffbeb", borderRadius: 8, padding: "6px 10px" }}>
                  {playbook.caution}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <section
        style={{ marginTop: 24, background: "#f8fafc", borderRadius: 12, padding: "12px 16px", borderLeft: "5px solid #0891b2" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>いまのこの方 (自動でまとまるノート)</h2>
          {contact.profileDigestAt && (
            <small style={{ color: "#64748b" }}>{new Date(contact.profileDigestAt).toLocaleDateString("ja-JP")} 更新</small>
          )}
        </div>
        {contact.profileDigest ? (
          <p style={{ margin: "8px 0", color: "#334155", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{contact.profileDigest}</p>
        ) : (
          <p style={{ margin: "8px 0", color: "#64748b" }}>
            やりとりを記録していくと、この方の近況や話すと喜ばれそうな話題が、ここに自動でまとまっていきます。
          </p>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn(false)} onClick={() => void refreshDigest(false)} disabled={!!busy}>
            記録からまとめ直す
          </button>
          <button style={btn(false)} onClick={() => void refreshDigest(true)} disabled={!!busy}>
            公開情報も調べてまとめ直す
          </button>
        </div>
      </section>

      <section style={{ marginTop: 24, border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>この方のSNS・公開の発信</h2>
        <p style={{ fontSize: 13, color: "#475569", margin: "6px 0" }}>
          この方が公開している X・Instagram・LinkedIn・note・ブログなどを控えておくと、最近の様子をつかんで
          お声がけの一言に生かせます。上の「公開情報も調べてまとめ直す」を押したときだけ、ここを手がかりに近況を調べます。
        </p>
        {snsAccounts.length > 0 ? (
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0", display: "grid", gap: 6 }}>
            {snsAccounts.map((a, i) => (
              <li key={i} style={{ fontSize: 14, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: "#64748b", minWidth: 120 }}>{SNS_LABEL[a.platform] ?? a.platform}</span>
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", wordBreak: "break-all" }}>
                    {a.handle || a.url}
                  </a>
                ) : (
                  <span>{a.handle}</span>
                )}
                <button
                  style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 12 }}
                  disabled={!!busy}
                  aria-label="外す"
                  onClick={async () => {
                    const next = snsAccounts.filter((_, j) => j !== i);
                    const body = await call(
                      `contacts/${contact.id}/sns`,
                      { method: "PUT", body: JSON.stringify({ accounts: next }) },
                      "外しました",
                    );
                    if (body) setSnsAccounts(body.accounts ?? []);
                  }}
                >
                  外す
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: 14, color: "#64748b", margin: "8px 0" }}>まだ登録がありません</p>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            style={{ ...input, flex: 1, minWidth: 200 }}
            placeholder="URL を貼るか、note: ユーザー名 のように"
            aria-label="SNS アカウント"
            value={snsInput}
            onChange={(e) => setSnsInput(e.target.value)}
          />
          <button
            style={btn(false)}
            disabled={!!busy || !snsInput.trim()}
            onClick={async () => {
              const merged = [...snsAccounts.map((a) => a.url || `${a.platform}: ${a.handle}`), snsInput].join("\n");
              const body = await call(
                `contacts/${contact.id}/sns`,
                { method: "PUT", body: JSON.stringify({ raw: merged }) },
                "登録しました",
              );
              if (body) {
                setSnsAccounts(body.accounts ?? []);
                setSnsInput("");
              }
            }}
          >
            登録する
          </button>
        </div>
      </section>

      {(() => {
        let facets: Facets | null = null;
        try {
          facets = contact.profileFacets ? (JSON.parse(contact.profileFacets) as Facets) : null;
        } catch {
          facets = null;
        }
        const hasAny =
          facets &&
          [...FACET_TEXT, ...FACET_LIST].some((f) => {
            const v = facets![f.key];
            return Array.isArray(v) ? v.length > 0 : !!v;
          });
        return (
          <section style={{ marginTop: 24, border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <h2 style={{ fontSize: 18, margin: 0 }}>この方の論点</h2>
              {contact.profileFacetsAt && (
                <small style={{ color: "#64748b" }}>{new Date(contact.profileFacetsAt).toLocaleDateString("ja-JP")} 更新</small>
              )}
            </div>
            {hasAny ? (
              <div style={{ marginTop: 8 }}>
                {facets!.summary && <p style={{ color: "#0f172a", fontWeight: 600, margin: "4px 0 10px" }}>{facets!.summary}</p>}
                {FACET_TEXT.map((f) =>
                  facets![f.key] ? (
                    <div key={f.key} style={{ margin: "6px 0" }}>
                      <span style={{ color: "#64748b", fontSize: 13 }}>{f.label}</span>
                      <p style={{ margin: "2px 0", color: "#334155", lineHeight: 1.8 }}>{facets![f.key] as string}</p>
                    </div>
                  ) : null,
                )}
                {FACET_LIST.map((f) => {
                  const arr = (facets![f.key] as string[] | undefined) ?? [];
                  return arr.length ? (
                    <div key={f.key} style={{ margin: "6px 0" }}>
                      <span style={{ color: "#64748b", fontSize: 13 }}>{f.label}</span>
                      <p style={{ margin: "2px 0", color: "#334155", lineHeight: 1.8 }}>{arr.join(" / ")}</p>
                    </div>
                  ) : null;
                })}
              </div>
            ) : (
              <p style={{ margin: "8px 0", color: "#64748b" }}>
                記録がたまってきたら、この方の状況・スキル・悩み・ご家族・目標などを、いくつもの観点に整理できます。
              </p>
            )}
            <button style={btn(false)} onClick={() => void generateFacets()} disabled={!!busy}>
              {hasAny ? "論点を整理し直す" : "記録から論点を整理する"}
            </button>
          </section>
        );
      })()}

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
            <div style={{ margin: "4px 0 8px" }}>
              <button
                style={{ ...btn(false), fontSize: 13, padding: "5px 12px" }}
                disabled={!!busy}
                onClick={async () => {
                  const body = await call(`contacts/${contact.id}/free-slots-text?days=14`, { method: "GET" } as RequestInit);
                  if (!body) return;
                  if (!body.hasMyCalendar) {
                    setNotice("先に予定表を連携すると、空いている日時をここに貼り付けられます。下の「お会いする日を探す」から連携できます。");
                    return;
                  }
                  if (body.count === 0) {
                    setNotice("これからの2週間に、お伝えできる空き時間が見つかりませんでした。");
                    return;
                  }
                  const intro = body.basis === "overlap"
                    ? "\n\nお会いできればと思っております。おふたりのご都合が合いそうなのは、次の日時です。\n"
                    : "\n\nもしよろしければお会いできればと思っております。私のほうで空いておりますのは、次の日時です。\n";
                  setEditBody((editBody + intro + body.text + "\nご都合に合う時間がありましたら、お知らせください。").trim());
                }}
              >
                {busy.includes("free-slots-text") ? "調べています…" : "空いている日時を本文に貼り付ける"}
              </button>
            </div>
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
        <h2 style={{ fontSize: 18 }}>贈り物を選ぶ</h2>
        <p style={{ color: "#64748b", fontSize: 14, marginTop: 0 }}>
          この方のことをふまえて、喜ばれそうな贈り物と、その探し方をご提案します。
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select value={giftOccasion} onChange={(e) => setGiftOccasion(e.target.value)} aria-label="贈る場面" style={{ ...input, width: "auto" }}>
            <option value="other">ふだんの贈り物</option>
            <option value="お誕生日">お誕生日</option>
            <option value="記念日">記念日</option>
            <option value="お中元">お中元</option>
            <option value="お歳暮">お歳暮</option>
            <option value="お祝い">お祝い</option>
            <option value="お返し">お返し</option>
          </select>
          <input
            style={{ ...input, width: 140 }}
            placeholder="予算 (例: 5000円)"
            aria-label="予算"
            value={giftBudget}
            onChange={(e) => setGiftBudget(e.target.value)}
          />
          <button
            style={btn(false)}
            disabled={!!busy}
            onClick={async () => {
              const body = await call(`contacts/${contact.id}/gift-suggest`, {
                method: "POST",
                body: JSON.stringify({
                  occasion: giftOccasion === "other" ? "" : giftOccasion,
                  budget: giftBudget,
                }),
              });
              if (body?.suggestions) {
                setGiftSuggestions(body.suggestions);
                setGiftNote(body.note ?? "");
              }
            }}
          >
            {busy.includes("gift-suggest") ? "考えています…" : "提案してもらう"}
          </button>
        </div>
        {giftSuggestions && (
          <div style={{ display: "grid", gap: 10, marginBottom: 8 }}>
            {giftSuggestions.map((s, i) => (
              <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontWeight: 600 }}>{s.idea}{s.priceRange ? `（${s.priceRange}）` : ""}</div>
                {s.why && <div style={{ fontSize: 14, marginTop: 4 }}>{s.why}</div>}
                {s.howToFind && <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>探し方: {s.howToFind}</div>}
                <button
                  style={{ ...btn(false), marginTop: 6, fontSize: 13, padding: "4px 10px" }}
                  disabled={!!busy}
                  onClick={async () => {
                    const body = await call(`contacts/${contact.id}/gifts`, {
                      method: "POST",
                      body: JSON.stringify({ occasion: "other", item: s.idea }),
                    }, "贈り物の予定として記録しました");
                    if (body) await load();
                  }}
                >
                  これを贈る予定にする
                </button>
              </div>
            ))}
            {giftNote && <p style={{ fontSize: 13, color: "#475569" }}>{giftNote}</p>}
          </div>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18 }}>贈り物の記録</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select value={giftDirection} onChange={(e) => setGiftDirection(e.target.value)} aria-label="贈った・いただいた" style={{ ...input, width: "auto" }}>
            <option value="outbound">贈った</option>
            <option value="inbound">いただいた</option>
          </select>
          <select value={giftOccasion} onChange={(e) => setGiftOccasion(e.target.value)} aria-label="機会" style={{ ...input, width: "auto" }}>
            <option value="birthday">お誕生日</option>
            <option value="new_year">お年賀</option>
            <option value="celebration">お祝い</option>
            <option value="thanks">お礼</option>
            <option value="other">その他</option>
          </select>
          <input
            style={{ ...input, flex: 1, minWidth: 160 }}
            placeholder="品物 (例: 季節の花)"
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
                body: JSON.stringify({ occasion: giftOccasion, item: giftItem, direction: giftDirection }),
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
        <h2 style={{ fontSize: 18 }}>やり取りの台帳</h2>
        <p style={{ fontSize: 13, color: "#475569" }}>
          この方との貢献・貸し借り・お約束・お取引を書き留めておけます。返すお約束や期日のあるものは、近づくとお知らせします。
        </p>
        {exLedger && (exLedger.outboundCount > 0 || exLedger.inboundCount > 0 || exLedger.openCount > 0) && (
          <p style={{ fontSize: 13, color: "#334155" }}>
            こちらから {exLedger.outboundCount} 件
            {exLedger.outboundValue > 0 ? `（${exLedger.outboundValue.toLocaleString("ja-JP")}円ぶん）` : ""}、
            いただいた・お借りしたのが {exLedger.inboundCount} 件
            {exLedger.inboundValue > 0 ? `（${exLedger.inboundValue.toLocaleString("ja-JP")}円ぶん）` : ""}。
            {exLedger.openCount > 0 ? ` 進行中が ${exLedger.openCount} 件。` : ""}
            {exLedger.needsReturn ? " お返しをまだしていないものがあります。" : ""}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select value={exKind} onChange={(e) => setExKind(e.target.value)} aria-label="種類" style={{ ...input, width: "auto" }}>
            <option value="favor">貢献・手助け</option>
            <option value="loan">貸し借り</option>
            <option value="promise">お約束</option>
            <option value="deal">お取引</option>
            <option value="gift">贈り物</option>
            <option value="other">その他</option>
          </select>
          <select value={exDirection} onChange={(e) => setExDirection(e.target.value)} aria-label="向き" style={{ ...input, width: "auto" }}>
            <option value="outbound">こちらから</option>
            <option value="inbound">いただいた・お借りした</option>
          </select>
          <select value={exStatus} onChange={(e) => setExStatus(e.target.value)} aria-label="状態" style={{ ...input, width: "auto" }}>
            <option value="done">済んだこと</option>
            <option value="open">進行中・これから</option>
          </select>
          <input
            style={{ ...input, flex: 1, minWidth: 180 }}
            placeholder="内容 (例: 引っ越しを手伝った / 1万円お借りした)"
            aria-label="やり取りの内容"
            value={exTitle}
            onChange={(e) => setExTitle(e.target.value)}
          />
          <input
            style={{ ...input, width: 120 }}
            placeholder="金額 (任意)"
            aria-label="金額"
            inputMode="numeric"
            value={exValue}
            onChange={(e) => setExValue(e.target.value)}
          />
          {exStatus === "open" && (
            <input
              style={{ ...input, width: "auto" }}
              type="date"
              aria-label="いつまでに"
              value={exDueAt}
              onChange={(e) => setExDueAt(e.target.value)}
            />
          )}
          <button
            style={btn(false)}
            disabled={!!busy || !exTitle.trim()}
            onClick={async () => {
              const body = await call(
                `contacts/${contact.id}/exchanges`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    kind: exKind,
                    direction: exDirection,
                    status: exStatus,
                    title: exTitle,
                    value: exValue.trim() ? Number(exValue.replace(/[^0-9]/g, "")) : undefined,
                    dueAt: exStatus === "open" && exDueAt ? exDueAt : undefined,
                  }),
                },
                "書き留めました",
              );
              if (body) {
                setExTitle("");
                setExValue("");
                setExDueAt("");
                await load();
              }
            }}
          >
            書き留める
          </button>
        </div>
        <ul>
          {exchanges.map((e) => (
            <li key={e.id} style={{ marginBottom: 4 }}>
              {new Date(e.occurredAt).toLocaleDateString("ja-JP")}{" "}
              {e.direction === "outbound" ? "こちらから" : "いただいた・お借りした"}: {e.title}
              {e.value ? `（${e.value.toLocaleString("ja-JP")}円）` : ""}
              {e.status === "open" && (
                <>
                  {" "}
                  <span style={{ color: "#b45309" }}>
                    進行中{e.dueAt ? `・${new Date(e.dueAt).toLocaleDateString("ja-JP")}まで` : ""}
                  </span>{" "}
                  <button
                    style={{ ...btn(false), padding: "2px 8px", fontSize: 12 }}
                    disabled={!!busy}
                    onClick={async () => {
                      const body = await call(`exchanges/${e.id}`, { method: "PUT", body: JSON.stringify({ status: "done" }) }, "済みにしました");
                      if (body) await load();
                    }}
                  >
                    済みにする
                  </button>
                </>
              )}{" "}
              <button
                style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 12 }}
                disabled={!!busy}
                aria-label="削除"
                onClick={async () => {
                  const body = await call(`exchanges/${e.id}`, { method: "DELETE" }, "削除しました");
                  if (body) await load();
                }}
              >
                削除
              </button>
            </li>
          ))}
          {exchanges.length === 0 && <li style={{ color: "#64748b" }}>まだ記録がありません</li>}
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
