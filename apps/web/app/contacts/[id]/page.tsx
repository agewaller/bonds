"use client";
// 連絡先詳細 — 把握 (プロフィール・価値観下書き) / 打ち手 (面談候補・文面候補) /
// 実行 (承認 → 送信) / 検証 (やりとりの記録) を一画面に。
// 外に出る行動は必ず「下書き → 承認 → 送信」(CLAUDE.md 自律性の段階)。
import { useCallback, useEffect, useState } from "react";
import Fold from "../../../components/Fold";
import { apiFetch } from "../../../lib/client-api";
import { t, currentLocale } from "../../../lib/i18n";
import { safeExternalUrl, urlHost } from "../../../lib/safe-url";
import { MessagesSection } from "../../../components/MessagesSection";
import { SharesSection } from "../../../components/SharesSection";
import Link from "next/link";
import { useParams } from "next/navigation";

type Contact = {
  id: string;
  name: string;
  furigana: string | null;
  distance: number;
  relationship: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;
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
  { key: "contact", label: "c_facet_contact" },
  { key: "status", label: "c_facet_status" },
  { key: "work", label: "c_facet_work" },
  { key: "family", label: "c_facet_family" },
  { key: "health", label: "c_facet_health" },
  { key: "values", label: "c_facet_values" },
];
const FACET_LIST: { key: keyof Facets; label: string }[] = [
  { key: "skills", label: "c_facet_skills" },
  { key: "concerns", label: "c_facet_concerns" },
  { key: "goals", label: "c_facet_goals" },
  { key: "likes", label: "c_facet_likes" },
  { key: "cautions", label: "c_facet_cautions" },
  { key: "opportunities", label: "c_facet_opportunities" },
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
  x: "c_sns_label_x",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  note: "note",
  youtube: "YouTube",
  tiktok: "TikTok",
  threads: "Threads",
  github: "GitHub",
  blog: "c_sns_label_blog",
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
  return `${st.getMonth() + 1}${t("c_month_suffix")}${st.getDate()}${t("c_day_suffix")} ${st.getHours()}:${String(st.getMinutes()).padStart(2, "0")} ${t("c_slot_range_sep")} ${en.getHours()}:${String(en.getMinutes()).padStart(2, "0")}`;
}

// 距離感 1〜5 のやさしいラベル (専門用語を避ける。65歳ペルソナ)。
const DISTANCE_LABEL: Record<number, string> = {
  1: "c_dd1",
  2: "c_dd2",
  3: "c_dd3",
  4: "c_dd4",
  5: "c_dd5",
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
  const [snsCandidates, setSnsCandidates] = useState<{ platform: string; handle: string; url: string }[]>([]);
  const [snsInput, setSnsInput] = useState("");
  const [channel, setChannel] = useState("email");
  const [sendAt, setSendAt] = useState("");
  const [linkSlug, setLinkSlug] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [theirIcsUrl, setTheirIcsUrl] = useState("");
  const [shareUrl, setShareUrl] = useState("");
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
  // 近況メモ・いただいた返信の還流 (書けば接触記録 + 論点整理の自動更新)
  const [quickText, setQuickText] = useState("");
  const [quickKind, setQuickKind] = useState("note");
  // 会社の最近の動き (所属先の公開ニュースの要約 + 連絡のきっかけ)
  const [companyNews, setCompanyNews] = useState<{ news: string; hook: string; sources: string[]; detail?: string } | null>(null);
  // 関係の目標 (用途 × 目標距離感 → ペースと次の一手)
  type GoalPlanView = { direction: string; paceLabel: string; nextMove: string; overdue: boolean; progress: number; gap: number };
  const [goal, setGoal] = useState<{ purpose: string; targetDistance: number; note: string } | null>(null);
  const [goalPlanView, setGoalPlanView] = useState<GoalPlanView | null>(null);
  const [goalEdit, setGoalEdit] = useState(false);
  const [gPurpose, setGPurpose] = useState("business");
  const [gTarget, setGTarget] = useState("3");
  const [gNote, setGNote] = useState("");

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
    setGoal(body.goal ?? null);
    setGoalPlanView(body.goalPlan ?? null);
    if (body.goal) {
      setGPurpose(body.goal.purpose);
      setGTarget(String(body.goal.targetDistance));
      setGNote(body.goal.note ?? "");
    }
    const exRes = await apiFetch(`contacts/${id}/exchanges`);
    if (exRes.ok) {
      const exBody = await exRes.json();
      setExchanges(exBody.exchanges ?? []);
      setExLedger(exBody.ledger ?? null);
    }
    const snsRes = await apiFetch(`contacts/${id}/sns`);
    if (snsRes.ok) {
      const snsBody = await snsRes.json();
      setSnsAccounts(snsBody.accounts ?? []);
      setSnsCandidates(snsBody.candidates ?? []);
    }
    setForm({
      name: body.contact.name ?? "",
      furigana: body.contact.furigana ?? "",
      company: body.contact.company ?? "",
      title: body.contact.title ?? "",
      phone: body.contact.phone ?? "",
      birthday: (body.contact.birthday ?? "").slice(0, 10),
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
        // reason はサーバが添える具体的な失敗理由 (送信サービスの応答など)。あれば併記する
        const reason = typeof body.reason === "string" && body.reason ? ` (${t("c_detail_label")}${body.reason})` : "";
        setError((body.detail ?? t("c_generic_failed")) + reason);
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
      { method: "PUT", body: JSON.stringify({ distance: contact.distance, ...form, name: (form.name ?? "").trim() || contact.name }) },
      t("c_saved"),
    );
    if (body) await load();
  };

  const refreshDigest = async (includePublic: boolean) => {
    if (!contact) return;
    const body = await call(`contacts/${contact.id}/refresh-digest`, {
      method: "POST",
      body: JSON.stringify({ includePublic, locale: currentLocale() }),
    });
    if (body?.digest) {
      setNotice(
        includePublic && !body.searched
          ? t("c_digest_no_public")
          : t("c_digest_refreshed"),
      );
      await load();
    }
  };

  const generateFacets = async () => {
    if (!contact) return;
    const body = await call(`contacts/${contact.id}/facets`, { method: "POST", body: JSON.stringify({ locale: currentLocale() }) });
    if (body?.facets) {
      setNotice(t("c_facets_generated"));
      await load();
    }
  };

  const enrichValues = async () => {
    if (!contact) return;
    const body = await call(`contacts/${contact.id}/enrich-values`, { method: "POST", body: JSON.stringify({ locale: currentLocale() }) });
    if (body?.draft) {
      setForm((f) => ({ ...f, valuesProfile: body.draft }));
      setNotice(t("c_values_draft_made"));
    }
  };

  const loadSlots = async () => {
    if (!contact) return;
    const body = await call(`contacts/${contact.id}/meeting-slots?days=14`, { method: "GET" });
    if (body) {
      setSlots(body.proposals);
      if (!body.hasMyCalendar) setNotice(t("c_no_my_calendar"));
    }
  };

  const makeDraft = async () => {
    if (!contact) return;
    const body = await call(
      "outreach/draft",
      { method: "POST", body: JSON.stringify({ contactId: contact.id, purpose, points, channel, locale: currentLocale() }) },
      t("c_draft_made"),
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
        setSentInfo(t("c_marked_sent"));
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
        setSentInfo(t("c_scheduled"));
        setCandidates(null);
        setDraftId("");
      }
      return;
    }
    const sent = await call(`outreach/${draftId}/send`, { method: "POST", body: "{}" });
    if (sent) {
      setSentInfo(t("c_sent"));
      setCandidates(null);
      setDraftId("");
      await load();
    }
  };

  if (notFound) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>{t("c_not_found")}</p>
        <p><Link href="/contacts" style={{ color: "#2563eb" }}>{t("c_back_contacts")}</Link></p>
      </main>
    );
  }
  if (!contact) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>{t("c_loading")}</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <p>
        <Link href="/contacts" style={{ color: "#2563eb" }}>{t("c_back_contacts")}</Link>
      </p>
      <h1 style={{ fontSize: 24 }}>{contact.name}</h1>
      <p style={{ color: "#64748b" }}>
        {contact.company} {contact.title}
      </p>
      {contact.email && (
        <p style={{ margin: "4px 0 12px" }}>
          <a
            href={`mailto:${contact.email}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#2563eb", color: "#fff", borderRadius: 8, textDecoration: "none", fontSize: 14 }}
          >
            ✉ {t("c_send_email")}
          </a>
          <span style={{ color: "#94a3b8", fontSize: 12, marginLeft: 8 }}>{contact.email}</span>
        </p>
      )}

      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>
      )}

      {relScore && (
        <Fold k="cd0" title={<>{t("c_rel_title")}</>} style={{ marginTop: 20, border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "10px 0" }}>
            <ScoreTile label={t("c_distance_label")} value={`${relScore.distance}`} suffix="/5" caption={t(DISTANCE_LABEL[relScore.distance] ?? "")} />
            <ScoreTile label={t("c_depth_label")} value={`${relScore.depth}`} suffix="/100" caption={relScore.depthBand} />
            <ScoreTile label={t("c_potential_label")} value={`${relScore.potential}`} suffix="/100" caption={relScore.potentialBand} />
          </div>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13, lineHeight: 1.8 }}>{relScore.reason}</p>
          <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 12, lineHeight: 1.7 }}>
            {t("c_rel_explain")}
          </p>
          <div style={{ marginTop: 12 }}>
            <button
              style={btn(true)}
              disabled={!!busy}
              onClick={async () => {
                const body = await call(`contacts/${contact.id}/playbook`, { method: "POST", body: JSON.stringify({ locale: currentLocale() }) });
                if (body?.actions || body?.relationship) setPlaybook(body);
              }}
            >
              {busy.includes("playbook") ? t("c_thinking") : t("c_playbook_btn")}
            </button>
            <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 13 }}>
              {t("c_playbook_desc")}
            </p>
          </div>
          {playbook && (
            <div style={{ marginTop: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px" }}>
              {playbook.relationship && (
                <p style={{ margin: "0 0 10px", color: "#334155", lineHeight: 1.9 }}>{playbook.relationship}</p>
              )}
              {playbook.intersections.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{t("c_intersections_title")}</div>
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
                  {t("c_something_new_prefix")}{playbook.somethingNew}
                </p>
              )}
              {playbook.caution && (
                <p style={{ marginTop: 8, fontSize: 13, color: "#92400e", background: "#fffbeb", borderRadius: 8, padding: "6px 10px" }}>
                  {playbook.caution}
                </p>
              )}
            </div>
          )}
        </Fold>
      )}

      <Fold k="cd1" title={<>{t("c_goal_card_title")}</>} style={{ marginTop: 20, border: "1px solid #ddd6fe", background: "#faf5ff", borderRadius: 12, padding: "12px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          {goal && !goalEdit && (
            <button
              style={{ padding: "4px 10px", background: "transparent", color: "#7c3aed", border: "1px solid #ddd6fe", borderRadius: 8, cursor: "pointer", fontSize: 12 }}
              onClick={() => setGoalEdit(true)}
            >
              {t("c_change_goal")}
            </button>
          )}
        </div>
        {!goal && !goalEdit && (
          <div>
            <p style={{ fontSize: 13, color: "#6b21a8", margin: "6px 0 8px" }}>
              {t("c_goal_empty_desc")}
            </p>
            <button style={btn(true)} onClick={() => setGoalEdit(true)}>{t("c_set_goal")}</button>
          </div>
        )}
        {goal && !goalEdit && goalPlanView && (
          <div style={{ marginTop: 8 }}>
            <p style={{ margin: 0, fontSize: 14, color: "#334155" }}>
              {{ business: t("c_purpose_business"), friend: t("c_purpose_friend"), romance: t("c_purpose_romance"), family: t("c_purpose_family"), community: t("c_purpose_community"), other: t("c_other") }[goal.purpose] ?? goal.purpose}
              {t("c_goal_line_a")}{contact.distance}{t("c_from")}{goal.targetDistance}{" ("}{t(DISTANCE_LABEL[goal.targetDistance] ?? "")}{t("c_goal_line_b")}{goalPlanView.paceLabel}{t("c_goal_line_c")}
              {goalPlanView.progress > 0 && `${t("c_goal_line_d")}${goalPlanView.progress}${t("c_goal_line_e")}`}
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 14, color: "#0f766e", lineHeight: 1.8, background: "#fff", border: "1px solid #e9d5ff", borderRadius: 10, padding: "8px 12px" }}>
              {t("c_next_move_label")}{goalPlanView.nextMove}
            </p>
            {goal.note && <p style={{ margin: "6px 0 0", fontSize: 13, color: "#6b21a8" }}>{t("c_aim_label")}{goal.note}</p>}
          </div>
        )}
        {goalEdit && (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select value={gPurpose} onChange={(e) => setGPurpose(e.target.value)} style={{ padding: "6px 8px", border: "1px solid #ddd6fe", borderRadius: 8, fontSize: 13 }}>
                <option value="business">{t("c_purpose_business")}</option>
                <option value="friend">{t("c_purpose_friend")}</option>
                <option value="romance">{t("c_purpose_romance")}</option>
                <option value="family">{t("c_purpose_family")}</option>
                <option value="community">{t("c_purpose_community")}</option>
                <option value="other">{t("c_other")}</option>
              </select>
              <select value={gTarget} onChange={(e) => setGTarget(e.target.value)} style={{ padding: "6px 8px", border: "1px solid #ddd6fe", borderRadius: 8, fontSize: 13 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{t("c_target_opt_prefix")}{n} ({t(DISTANCE_LABEL[n] ?? "")})</option>
                ))}
              </select>
            </div>
            <input
              value={gNote}
              onChange={(e) => setGNote(e.target.value)}
              placeholder={t("c_goal_note_ph")}
              style={{ padding: "6px 8px", border: "1px solid #ddd6fe", borderRadius: 8, fontSize: 13 }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                style={btn(true)}
                disabled={!!busy}
                onClick={async () => {
                  const body = await call(
                    `contacts/${contact.id}/goal`,
                    { method: "PUT", body: JSON.stringify({ purpose: gPurpose, targetDistance: Number(gTarget), note: gNote }) },
                    t("c_goal_set_msg"),
                  );
                  if (body) {
                    setGoal(body.goal);
                    setGoalPlanView(body.plan);
                    setGoalEdit(false);
                  }
                }}
              >
                {t("c_set_this_goal")}
              </button>
              <button
                style={{ padding: "8px 14px", background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                onClick={() => setGoalEdit(false)}
              >
                {t("c_cancel_btn")}
              </button>
              {goal && (
                <button
                  style={{ padding: "8px 14px", background: "transparent", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                  disabled={!!busy}
                  onClick={async () => {
                    const body = await call(`contacts/${contact.id}/goal`, { method: "DELETE" }, t("c_goal_removed"));
                    if (body) {
                      setGoal(null);
                      setGoalPlanView(null);
                      setGoalEdit(false);
                    }
                  }}
                >
                  {t("c_remove_goal_btn")}
                </button>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "#6b21a8" }}>
              {t("c_goal_footer")}
            </p>
          </div>
        )}
      </Fold>

      <Fold k="cd2" title={<>{t("c_quick_title")}</>} style={{ marginTop: 20, border: "1px solid #bae6fd", background: "#f0f9ff", borderRadius: 12, padding: "12px 16px" }}>
        <p style={{ fontSize: 13, color: "#075985", margin: "0 0 8px" }}>
          {t("c_quick_desc")}
        </p>
        <textarea
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          rows={3}
          placeholder={t("c_quick_ph")}
          style={{ width: "100%", padding: "8px 10px", border: "1px solid #bae6fd", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={quickKind}
            onChange={(e) => setQuickKind(e.target.value)}
            style={{ padding: "6px 8px", border: "1px solid #bae6fd", borderRadius: 8, fontSize: 13 }}
          >
            <option value="note">{t("c_quick_note_opt")}</option>
            <option value="reply">{t("c_quick_reply_opt")}</option>
          </select>
          <button
            style={btn(true)}
            disabled={!!busy || !quickText.trim()}
            onClick={async () => {
              const body = await call(
                `contacts/${contact.id}/note`,
                { method: "POST", body: JSON.stringify({ text: quickText, kind: quickKind }) },
                t("c_quick_saved"),
              );
              if (body) {
                setQuickText("");
                await load();
              }
            }}
          >
            {busy.includes("/note") ? t("c_saving_note") : t("c_save_note_btn")}
          </button>
        </div>
      </Fold>

      {contact.company && (
        <Fold k="cd3" title={<>{contact.company}{t("c_company_news_suffix")}</>} style={{ marginTop: 20, border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <button
              style={btn(true)}
              disabled={!!busy}
              onClick={async () => {
                const body = await call(`contacts/${contact.id}/company-news`, { method: "POST", body: JSON.stringify({ locale: currentLocale() }) });
                if (body) setCompanyNews(body);
              }}
            >
              {busy.includes("company-news") ? t("c_investigating") : t("c_investigate_btn")}
            </button>
          </div>
          <p style={{ fontSize: 13, color: "#64748b", margin: "6px 0 0" }}>
            {t("c_company_news_desc")}
          </p>
          {companyNews && (
            <div style={{ marginTop: 10, background: "#f8fafc", borderRadius: 10, padding: "10px 12px" }}>
              {companyNews.news ? (
                <p style={{ margin: 0, fontSize: 14, color: "#334155", lineHeight: 1.8 }}>{companyNews.news}</p>
              ) : (
                <p style={{ margin: 0, fontSize: 14, color: "#64748b" }}>{companyNews.detail ?? t("c_no_company_news")}</p>
              )}
              {companyNews.hook && (
                <p style={{ margin: "8px 0 0", fontSize: 14, color: "#0f766e", lineHeight: 1.8 }}>
                  {t("c_hook_label")}{companyNews.hook}
                </p>
              )}
              {companyNews.sources.length > 0 && (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "#94a3b8", wordBreak: "break-all" }}>
                  {t("c_sources_label")}{companyNews.sources.map((u, i) => {
                    const safe = safeExternalUrl(u);
                    return safe ? (
                      <a key={i} href={safe} target="_blank" rel="noreferrer" style={{ color: "#64748b", marginRight: 8 }}>
                        {urlHost(safe)}
                      </a>
                    ) : (
                      <span key={i} style={{ marginRight: 8 }}>{urlHost(u)}</span>
                    );
                  })}
                </p>
              )}
            </div>
          )}
        </Fold>
      )}

      <Fold k="cd4" title={<>{t("c_digest_title")}</>} style={{ marginTop: 24, background: "#f8fafc", borderRadius: 12, padding: "12px 16px", borderLeft: "5px solid #0891b2" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          {contact.profileDigestAt && (
            <small style={{ color: "#64748b" }}>{new Date(contact.profileDigestAt).toLocaleDateString("ja-JP")}{t("c_updated_suffix")}</small>
          )}
        </div>
        {contact.profileDigest ? (
          <p style={{ margin: "8px 0", color: "#334155", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{contact.profileDigest}</p>
        ) : (
          <p style={{ margin: "8px 0", color: "#64748b" }}>
            {t("c_digest_empty")}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn(false)} onClick={() => void refreshDigest(false)} disabled={!!busy}>
            {t("c_redigest_btn")}
          </button>
          <button style={btn(false)} onClick={() => void refreshDigest(true)} disabled={!!busy}>
            {t("c_redigest_public_btn")}
          </button>
        </div>
      </Fold>

      <Fold k="cd5" title={<>{t("c_sns_section_title")}</>} style={{ marginTop: 24, border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        <p style={{ fontSize: 13, color: "#475569", margin: "6px 0" }}>
          {t("c_sns_section_desc")}
        </p>
        {snsAccounts.length > 0 ? (
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0", display: "grid", gap: 6 }}>
            {snsAccounts.map((a, i) => (
              <li key={i} style={{ fontSize: 14, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: "#64748b", minWidth: 120 }}>{t(SNS_LABEL[a.platform] ?? a.platform)}</span>
                {safeExternalUrl(a.url) ? (
                  <a href={safeExternalUrl(a.url)!} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", wordBreak: "break-all" }}>
                    {a.handle || a.url}
                  </a>
                ) : (
                  <span>{a.handle || a.url}</span>
                )}
                <button
                  style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 12 }}
                  disabled={!!busy}
                  aria-label={t("c_remove_link_btn")}
                  onClick={async () => {
                    const next = snsAccounts.filter((_, j) => j !== i);
                    const body = await call(
                      `contacts/${contact.id}/sns`,
                      { method: "PUT", body: JSON.stringify({ accounts: next }) },
                      t("c_removed"),
                    );
                    if (body) setSnsAccounts(body.accounts ?? []);
                  }}
                >
                  {t("c_remove_link_btn")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: 14, color: "#64748b", margin: "8px 0" }}>{t("c_none_registered")}</p>
        )}
        {snsCandidates.length > 0 && (
          <div style={{ margin: "10px 0", border: "1px dashed #fbbf24", background: "#fffbeb", borderRadius: 10, padding: "10px 12px" }}>
            <p style={{ margin: "0 0 6px", fontSize: 13, color: "#92400e", fontWeight: 600 }}>
              {t("c_sns_cand_title")}
            </p>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "#a16207" }}>
              {t("c_sns_cand_desc")}
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
              {snsCandidates.map((cand, i) => (
                <li key={i} style={{ fontSize: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ color: "#92400e", minWidth: 110 }}>{t(SNS_LABEL[cand.platform] ?? cand.platform)}</span>
                  {safeExternalUrl(cand.url) ? (
                    <a href={safeExternalUrl(cand.url)!} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", wordBreak: "break-all", flex: 1 }}>
                      {cand.handle || cand.url}
                    </a>
                  ) : (
                    <span style={{ flex: 1 }}>{cand.handle || cand.url}</span>
                  )}
                  <button
                    style={{ padding: "4px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12 }}
                    disabled={!!busy}
                    onClick={async () => {
                      const body = await call(
                        `contacts/${contact.id}/sns-candidates`,
                        { method: "POST", body: JSON.stringify({ action: "approve", platform: cand.platform, handle: cand.handle }) },
                        t("c_sns_approved"),
                      );
                      if (body) {
                        setSnsAccounts(body.accounts ?? []);
                        setSnsCandidates(body.candidates ?? []);
                      }
                    }}
                  >
                    {t("c_its_them")}
                  </button>
                  <button
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14 }}
                    disabled={!!busy}
                    aria-label={`${cand.handle}${t("c_cand_delete_suffix")}`}
                    onClick={async () => {
                      const body = await call(
                        `contacts/${contact.id}/sns-candidates`,
                        { method: "POST", body: JSON.stringify({ action: "reject", platform: cand.platform, handle: cand.handle }) },
                        t("c_cand_removed"),
                      );
                      if (body) {
                        setSnsAccounts(body.accounts ?? []);
                        setSnsCandidates(body.candidates ?? []);
                      }
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            style={{ ...input, flex: 1, minWidth: 200 }}
            placeholder={t("c_sns_input_ph")}
            aria-label={t("c_aria_sns")}
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
                t("c_registered_msg"),
              );
              if (body) {
                setSnsAccounts(body.accounts ?? []);
                setSnsInput("");
              }
            }}
          >
            {t("c_register_btn")}
          </button>
        </div>
      </Fold>

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
          <Fold k="cd6" title={<>{t("c_facets_title")}</>} style={{ marginTop: 24, border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              {contact.profileFacetsAt && (
                <small style={{ color: "#64748b" }}>{new Date(contact.profileFacetsAt).toLocaleDateString("ja-JP")}{t("c_updated_suffix")}</small>
              )}
            </div>
            {hasAny ? (
              <div style={{ marginTop: 8 }}>
                {facets!.summary && <p style={{ color: "#0f172a", fontWeight: 600, margin: "4px 0 10px" }}>{facets!.summary}</p>}
                {FACET_TEXT.map((f) =>
                  facets![f.key] ? (
                    <div key={f.key} style={{ margin: "6px 0" }}>
                      <span style={{ color: "#64748b", fontSize: 13 }}>{t(f.label)}</span>
                      <p style={{ margin: "2px 0", color: "#334155", lineHeight: 1.8 }}>{facets![f.key] as string}</p>
                    </div>
                  ) : null,
                )}
                {FACET_LIST.map((f) => {
                  const arr = (facets![f.key] as string[] | undefined) ?? [];
                  return arr.length ? (
                    <div key={f.key} style={{ margin: "6px 0" }}>
                      <span style={{ color: "#64748b", fontSize: 13 }}>{t(f.label)}</span>
                      <p style={{ margin: "2px 0", color: "#334155", lineHeight: 1.8 }}>{arr.join(" / ")}</p>
                    </div>
                  ) : null;
                })}
              </div>
            ) : (
              <p style={{ margin: "8px 0", color: "#64748b" }}>
                {t("c_facets_empty")}
              </p>
            )}
            <button style={btn(false)} onClick={() => void generateFacets()} disabled={!!busy}>
              {hasAny ? t("c_facets_redo") : t("c_facets_make")}
            </button>
          </Fold>
        );
      })()}

      <Fold k="cd7" title={<>{t("c_profile_title")}</>} style={{ marginTop: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={{ display: "block", margin: "8px 0" }}>
            {t("c_name_label")}
            <input style={input} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            {t("c_furigana_label")}
            <input style={input} value={form.furigana ?? ""} onChange={(e) => setForm({ ...form, furigana: e.target.value })} />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            {t("c_company_label")}
            <input style={input} value={form.company ?? ""} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            {t("c_title_label")}
            <input style={input} value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            {t("c_phone_label")}
            <input style={input} value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            {t("c_birthday_label")}
            <input type="date" style={input} value={form.birthday ?? ""} onChange={(e) => setForm({ ...form, birthday: e.target.value })} />
          </label>
        </div>
        <label style={{ display: "block", margin: "8px 0" }}>
          {t("c_email_label")}
          <input style={input} value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label style={{ display: "block", margin: "8px 0" }}>
          {t("c_profile_status_label")}
          <textarea style={input} rows={3} value={form.personalProfile ?? ""} onChange={(e) => setForm({ ...form, personalProfile: e.target.value })} />
        </label>
        <label style={{ display: "block", margin: "8px 0" }}>
          {t("c_values_label")}
          <textarea style={input} rows={3} value={form.valuesProfile ?? ""} onChange={(e) => setForm({ ...form, valuesProfile: e.target.value })} />
        </label>
        <label style={{ display: "block", margin: "8px 0" }}>
          {t("c_memo_label")}
          <textarea style={input} rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btn()} onClick={() => void saveProfile()} disabled={!!busy}>{t("c_save_btn")}</button>
          <button style={btn(false)} onClick={() => void enrichValues()} disabled={!!busy}>
            {t("c_values_draft_btn")}
          </button>
        </div>
      </Fold>

      <Fold k="cd8" title={<>{t("c_meeting_title")}</>} style={{ marginTop: 32 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            style={{ ...input, flex: 1, width: "auto" }}
            placeholder={t("c_their_ics_ph")}
            aria-label={t("c_aria_their_ics")}
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
              }, t("c_their_cal_connected"));
              if (body) setTheirIcsUrl("");
            }}
          >
            {t("c_connect_cal_btn")}
          </button>
        </div>
        <button style={btn(false)} onClick={() => void loadSlots()} disabled={!!busy}>
          {t("c_find_slots_btn")}
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
                  {t("c_add_to_calendar")}
                </a>
              </li>
            ))}
            {slots.length === 0 && <li>{t("c_no_overlap")}</li>}
          </ul>
        )}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #f1f5f9" }}>
          <p style={{ margin: "0 0 6px", color: "#64748b", fontSize: 13, lineHeight: 1.7 }}>
            {t("c_share_desc")}
          </p>
          <button
            style={btn(false)}
            disabled={!!busy}
            onClick={async () => {
              const body = await call("schedule/shares", {
                method: "POST",
                body: JSON.stringify({ contactId: contact.id, title: `${contact.name}様との日程のご相談` }),
              }, t("c_share_made"));
              if (body?.url) setShareUrl(body.url);
            }}
          >
            {t("c_make_share_btn")}
          </button>
          {shareUrl && (
            <p style={{ margin: "8px 0 0", background: "#f8fafc", padding: 8, borderRadius: 8 }}>
              <span style={{ wordBreak: "break-all" }}>{shareUrl}</span>{" "}
              <button
                style={{ ...btn(false), fontSize: 13, padding: "4px 10px" }}
                onClick={() => void navigator.clipboard.writeText(shareUrl).then(() => setNotice(t("c_link_copied")))}
              >
                {t("c_copy_btn")}
              </button>
              <a href="/schedule" style={{ color: "#2563eb", marginLeft: 8, fontSize: 13 }}>{t("c_check_proposals")}</a>
            </p>
          )}
        </div>
      </Fold>

      <Fold k="cd9" title={<>{t("c_outreach_title")}</>} style={{ marginTop: 32 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label={t("c_aria_channel")} style={{ ...input, width: "auto" }}>
            <option value="email">{t("c_ch_email")}</option>
            <option value="gift">{t("c_ch_gift")}</option>
            <option value="nengajo">{t("c_ch_nengajo")}</option>
            <option value="meeting_invite">{t("c_ch_meeting")}</option>
          </select>
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label={t("c_aria_purpose")} style={{ ...input, width: "auto" }}>
            <option value="keepup">{t("c_p_keepup")}</option>
            <option value="birthday">{t("c_p_birthday")}</option>
            <option value="thanks">{t("c_p_thanks")}</option>
            <option value="meeting">{t("c_p_meeting")}</option>
            <option value="contribution">{t("c_p_contribution")}</option>
            <option value="repair">{t("c_p_repair")}</option>
          </select>
          <input
            style={{ ...input, flex: 1 }}
            placeholder={t("c_points_ph")}
            aria-label={t("c_points_ph")}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
          <button style={btn()} onClick={() => void makeDraft()} disabled={!!busy}>
            {busy === "outreach/draft" ? t("c_thinking") : t("c_make_draft_btn")}
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
                  {t("c_plan_prefix")}{i + 1} {c.tone}
                </button>
              ))}
            </div>
            <label style={{ display: "block", margin: "8px 0" }}>
              {t("c_subject_label")}
              <input style={input} value={editSubject} onChange={(e) => setEditSubject(e.target.value)} aria-label={t("c_subject_label")} />
            </label>
            <label style={{ display: "block", margin: "8px 0" }}>
              {t("c_body_label")}
              <textarea style={input} rows={8} value={editBody} onChange={(e) => setEditBody(e.target.value)} aria-label={t("c_aria_body")} />
            </label>
            <div style={{ margin: "4px 0 8px" }}>
              <button
                style={{ ...btn(false), fontSize: 13, padding: "5px 12px" }}
                disabled={!!busy}
                onClick={async () => {
                  const body = await call(`contacts/${contact.id}/free-slots-text?days=14`, { method: "GET" } as RequestInit);
                  if (!body) return;
                  if (!body.hasMyCalendar) {
                    setNotice(t("c_slots_need_cal"));
                    return;
                  }
                  if (body.count === 0) {
                    setNotice(t("c_slots_none"));
                    return;
                  }
                  const intro = body.basis === "overlap"
                    ? t("c_slots_intro_overlap")
                    : t("c_slots_intro_mine");
                  setEditBody((editBody + intro + body.text + t("c_slots_outro")).trim());
                }}
              >
                {busy.includes("free-slots-text") ? t("c_investigating") : t("c_paste_slots_btn")}
              </button>
            </div>
            {channel === "email" && (
              <label style={{ display: "block", margin: "8px 0", color: "#64748b", fontSize: 14 }}>
                {t("c_schedule_send_label")}
                <input
                  type="datetime-local"
                  value={sendAt}
                  onChange={(e) => setSendAt(e.target.value)}
                  aria-label={t("c_aria_send_at")}
                  style={{ ...input, width: "auto", marginLeft: 8 }}
                />
              </label>
            )}
            <button style={btn()} onClick={() => void approveAndSend()} disabled={!!busy}>
              {channel === "email" ? (sendAt ? t("c_approve_schedule") : t("c_approve_send")) : t("c_approve_manual")}
            </button>
            <p style={{ color: "#64748b", fontSize: 13 }}>
              {t("c_approve_note")}
            </p>
          </div>
        )}
        {sentInfo && <p style={{ color: "#166534" }}>{sentInfo}</p>}
      </Fold>

      <Fold k="cd10" title={<>{t("c_choose_gift")}</>} style={{ marginTop: 32 }}>
        <p style={{ color: "#64748b", fontSize: 14, marginTop: 0 }}>
          {t("c_gift_desc")}
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select value={giftOccasion} onChange={(e) => setGiftOccasion(e.target.value)} aria-label={t("c_aria_gift_occasion")} style={{ ...input, width: "auto" }}>
            <option value="other">{t("c_gift_occ_other")}</option>
            <option value="お誕生日">{t("c_p_birthday")}</option>
            <option value="記念日">{t("c_gift_occ_anniv")}</option>
            <option value="お中元">{t("c_gift_occ_chugen")}</option>
            <option value="お歳暮">{t("c_gift_occ_seibo")}</option>
            <option value="お祝い">{t("c_gift_occ_celebration")}</option>
            <option value="お返し">{t("c_gift_occ_return")}</option>
          </select>
          <input
            style={{ ...input, width: 140 }}
            placeholder={t("c_gift_budget_ph")}
            aria-label={t("c_aria_budget")}
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
                  locale: currentLocale(),
                }),
              });
              if (body?.suggestions) {
                setGiftSuggestions(body.suggestions);
                setGiftNote(body.note ?? "");
              }
            }}
          >
            {busy.includes("gift-suggest") ? t("c_thinking") : t("c_suggest_btn")}
          </button>
        </div>
        {giftSuggestions && (
          <div style={{ display: "grid", gap: 10, marginBottom: 8 }}>
            {giftSuggestions.map((s, i) => (
              <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontWeight: 600 }}>{s.idea}{s.priceRange ? `${t("c_po")}${s.priceRange}${t("c_pc")}` : ""}</div>
                {s.why && <div style={{ fontSize: 14, marginTop: 4 }}>{s.why}</div>}
                {s.howToFind && <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>{t("c_how_to_find_label")}{s.howToFind}</div>}
                <button
                  style={{ ...btn(false), marginTop: 6, fontSize: 13, padding: "4px 10px" }}
                  disabled={!!busy}
                  onClick={async () => {
                    const body = await call(`contacts/${contact.id}/gifts`, {
                      method: "POST",
                      body: JSON.stringify({ occasion: "other", item: s.idea }),
                    }, t("c_gift_planned"));
                    if (body) await load();
                  }}
                >
                  {t("c_plan_this_gift")}
                </button>
              </div>
            ))}
            {giftNote && <p style={{ fontSize: 13, color: "#475569" }}>{giftNote}</p>}
          </div>
        )}
      </Fold>

      <Fold k="cd11" title={<>{t("c_gift_log_title")}</>} style={{ marginTop: 32 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select value={giftDirection} onChange={(e) => setGiftDirection(e.target.value)} aria-label={t("c_aria_gift_direction")} style={{ ...input, width: "auto" }}>
            <option value="outbound">{t("c_gave")}</option>
            <option value="inbound">{t("c_received")}</option>
          </select>
          <select value={giftOccasion} onChange={(e) => setGiftOccasion(e.target.value)} aria-label={t("c_aria_occasion")} style={{ ...input, width: "auto" }}>
            <option value="birthday">{t("c_p_birthday")}</option>
            <option value="new_year">{t("c_gift_occ_newyear")}</option>
            <option value="celebration">{t("c_gift_occ_celebration")}</option>
            <option value="thanks">{t("c_p_thanks")}</option>
            <option value="other">{t("c_other")}</option>
          </select>
          <input
            style={{ ...input, flex: 1, minWidth: 160 }}
            placeholder={t("c_gift_item_ph")}
            aria-label={t("c_gift_word")}
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
              }, t("c_gift_recorded"));
              if (body) {
                setGiftItem("");
                await load();
              }
            }}
          >
            {t("c_record_btn")}
          </button>
        </div>
        <ul>
          {gifts.map((g) => (
            <li key={g.id}>
              {new Date(g.givenAt).toLocaleDateString("ja-JP")} {g.direction === "outbound" ? t("c_gave") : t("c_received")}: {g.item}
            </li>
          ))}
          {gifts.length === 0 && <li style={{ color: "#64748b" }}>{t("c_no_records")}</li>}
        </ul>
      </Fold>

      <Fold k="cd12" title={<>{t("c_ledger_title")}</>} style={{ marginTop: 32 }}>
        <p style={{ fontSize: 13, color: "#475569" }}>
          {t("c_ledger_desc")}
        </p>
        {exLedger && (exLedger.outboundCount > 0 || exLedger.inboundCount > 0 || exLedger.openCount > 0) && (
          <p style={{ fontSize: 13, color: "#334155" }}>
            {t("c_ledger_a")}{exLedger.outboundCount}{t("c_ledger_items")}
            {exLedger.outboundValue > 0 ? `${t("c_po")}${exLedger.outboundValue.toLocaleString("ja-JP")}${t("c_yen_worth")}` : ""}
            {t("c_ledger_b")}{exLedger.inboundCount}{t("c_ledger_items")}
            {exLedger.inboundValue > 0 ? `${t("c_po")}${exLedger.inboundValue.toLocaleString("ja-JP")}${t("c_yen_worth")}` : ""}
            {t("c_ledger_c")}
            {exLedger.openCount > 0 ? `${t("c_ledger_open_a")}${exLedger.openCount}${t("c_ledger_open_b")}` : ""}
            {exLedger.needsReturn ? t("c_ledger_needs_return") : ""}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select value={exKind} onChange={(e) => setExKind(e.target.value)} aria-label={t("c_aria_kind")} style={{ ...input, width: "auto" }}>
            <option value="favor">{t("c_ex_favor")}</option>
            <option value="loan">{t("c_ex_loan")}</option>
            <option value="promise">{t("c_ex_promise")}</option>
            <option value="deal">{t("c_ex_deal")}</option>
            <option value="gift">{t("c_gift_word")}</option>
            <option value="other">{t("c_other")}</option>
          </select>
          <select value={exDirection} onChange={(e) => setExDirection(e.target.value)} aria-label={t("c_aria_direction")} style={{ ...input, width: "auto" }}>
            <option value="outbound">{t("c_from_me")}</option>
            <option value="inbound">{t("c_received_borrowed")}</option>
          </select>
          <select value={exStatus} onChange={(e) => setExStatus(e.target.value)} aria-label={t("c_aria_status")} style={{ ...input, width: "auto" }}>
            <option value="done">{t("c_ex_done")}</option>
            <option value="open">{t("c_ex_open")}</option>
          </select>
          <input
            style={{ ...input, flex: 1, minWidth: 180 }}
            placeholder={t("c_ex_title_ph")}
            aria-label={t("c_aria_ex_content")}
            value={exTitle}
            onChange={(e) => setExTitle(e.target.value)}
          />
          <input
            style={{ ...input, width: 120 }}
            placeholder={t("c_ex_value_ph")}
            aria-label={t("c_aria_amount")}
            inputMode="numeric"
            value={exValue}
            onChange={(e) => setExValue(e.target.value)}
          />
          {exStatus === "open" && (
            <input
              style={{ ...input, width: "auto" }}
              type="date"
              aria-label={t("c_aria_due")}
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
                t("c_ex_noted"),
              );
              if (body) {
                setExTitle("");
                setExValue("");
                setExDueAt("");
                await load();
              }
            }}
          >
            {t("c_note_down_btn")}
          </button>
        </div>
        <ul>
          {exchanges.map((e) => (
            <li key={e.id} style={{ marginBottom: 4 }}>
              {new Date(e.occurredAt).toLocaleDateString("ja-JP")}{" "}
              {e.direction === "outbound" ? t("c_from_me") : t("c_received_borrowed")}: {e.title}
              {e.value ? `${t("c_po")}${e.value.toLocaleString("ja-JP")}${t("c_yen_paren")}` : ""}
              {e.status === "open" && (
                <>
                  {" "}
                  <span style={{ color: "#b45309" }}>
                    {t("c_ex_open_tag")}{e.dueAt ? `${t("c_sep")}${new Date(e.dueAt).toLocaleDateString("ja-JP")}${t("c_until_suffix")}` : ""}
                  </span>{" "}
                  <button
                    style={{ ...btn(false), padding: "2px 8px", fontSize: 12 }}
                    disabled={!!busy}
                    onClick={async () => {
                      const body = await call(`exchanges/${e.id}`, { method: "PUT", body: JSON.stringify({ status: "done" }) }, t("c_marked_done"));
                      if (body) await load();
                    }}
                  >
                    {t("c_mark_done_btn")}
                  </button>
                </>
              )}{" "}
              <button
                style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 12 }}
                disabled={!!busy}
                aria-label={t("c_delete_word")}
                onClick={async () => {
                  const body = await call(`exchanges/${e.id}`, { method: "DELETE" }, t("c_deleted"));
                  if (body) await load();
                }}
              >
                {t("c_delete_word")}
              </button>
            </li>
          ))}
          {exchanges.length === 0 && <li style={{ color: "#64748b" }}>{t("c_no_records")}</li>}
        </ul>
      </Fold>

      <Fold k="cd13" title={<>{t("c_public_figure_title")}</>} style={{ marginTop: 32 }}>
        {linkedSubjects.length > 0 ? (
          <ul>
            {linkedSubjects.map((l) => (
              <li key={l.linkId}>
                <Link href={`/subjects/${l.slug}`} style={{ color: "#2563eb" }}>{l.name}{t("c_view_eval_suffix")}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...input, flex: 1 }}
              placeholder={t("c_subject_id_ph")}
              aria-label={t("c_aria_subject_id")}
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
                }, t("c_linked"));
                if (body) {
                  setLinkSlug("");
                  await load();
                }
              }}
            >
              {t("c_link_btn")}
            </button>
          </div>
        )}
      </Fold>

      <Fold k="cd14" title={<>{t("c_interactions_title")}</>} style={{ marginTop: 32 }}>
        <ul>
          {interactions.map((i) => (
            <li key={i.id}>
              {new Date(i.occurredAt).toLocaleDateString("ja-JP")} {i.type}
              {i.notes ? ` — ${i.notes}` : ""}
            </li>
          ))}
          {interactions.length === 0 && <li style={{ color: "#64748b" }}>{t("c_no_records")}</li>}
        </ul>
      </Fold>

      <MessagesSection contactId={contact.id} contactEmail={contact.email} />

      <SharesSection contactId={contact.id} />
    </main>
  );
}
