"use client";
// 連絡帳 + つながりスコア + 「今日、連絡してみませんか」(lms の関係性ダッシュボードを移植)。
// 文言は寄り添い基調・技術語なし・記号装飾なし (CLAUDE.md 共通プロダクト原則)。
import { useCallback, useEffect, useRef, useState } from "react";
import Fold from "../../components/Fold";
import { apiFetch } from "../../lib/client-api";
import { AuthBar } from "../../components/AuthBar";
import { LanguageSelector } from "../../components/LanguageSelector";
import { t, currentLocale } from "../../lib/i18n";
import Link from "next/link";

type Contact = {
  id: string;
  name: string;
  furigana: string | null;
  distance: number;
  relationship: string;
  company: string | null;
  email: string | null;
  birthday: string | null;
};
type Progress = {
  streakDays: number;
  totalInteractions: number;
  badges: { key: string; label: string; achieved: boolean }[];
  nextMilestone: { label: string; current: number; target: number } | null;
};
type Summary = {
  connectionScore: number;
  isolation: { level: string; overdueCount: number; total: number };
  today: { contactId: string; name: string; kind: string; reason: string }[];
};
type Duplicate = {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  relationship: string;
  distance: number;
};

// SNS・サービスとの「連携」ボタン。友だち一覧を直接くれる SNS は無いのが実情なので、
// 各社が公式に用意する「自分のデータのダウンロード」を開き、届いたファイルを取り込む導線にする
// (Google だけは連絡先/カレンダー/メールの読み取り連携が本当にできる = 別枠)。
const SNS_CONNECTORS: { key: string; label: string; url: string; hintKey: string }[] = [
  {
    key: "line",
    label: "LINE",
    url: "https://guide.line.me/ja/services/chat-history.html",
    hintKey: "c_sns_hint_line",
  },
  {
    key: "x",
    label: "c_sns_label_x",
    url: "https://x.com/settings/download_your_data",
    hintKey: "c_sns_hint_x",
  },
  {
    key: "instagram",
    label: "Instagram",
    url: "https://accountscenter.facebook.com/info_and_permissions/dyi",
    hintKey: "c_sns_hint_instagram",
  },
  {
    key: "facebook",
    label: "Facebook",
    url: "https://accountscenter.facebook.com/info_and_permissions/dyi",
    hintKey: "c_sns_hint_facebook",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    url: "https://www.linkedin.com/mypreferences/d/download-my-data",
    hintKey: "c_sns_hint_linkedin",
  },
  {
    key: "outlook",
    label: "Outlook",
    url: "https://support.microsoft.com/ja-jp/office/outlook-から連絡先をエクスポートする-10f09abd-643c-4495-bb80-543714eca73f",
    hintKey: "c_sns_hint_outlook",
  },
];

const LEVEL_LABEL: Record<string, { label: string; color: string; message: string }> = {
  good: { label: "c_level_good", color: "#27ae60", message: "c_level_good_msg" },
  fair: { label: "c_level_fair", color: "#f1c40f", message: "c_level_fair_msg" },
  caution: { label: "c_level_caution", color: "#e67e22", message: "c_level_caution_msg" },
  warning: { label: "c_level_warning", color: "#e74c3c", message: "c_level_warning_msg" },
  unknown: { label: "c_level_unknown", color: "#8896a6", message: "c_level_unknown_msg" },
};

const DISTANCE_LABEL: Record<number, string> = {
  1: "c_dist1",
  2: "c_dist2",
  3: "c_dist3",
  4: "c_dist4",
  5: "c_dist5",
};

// 取り込み元の表示名 (迎えた経路ごとのリスト表示に使う。未知の値はそのまま出す)
const SOURCE_LABEL: Record<string, string> = {
  line: "LINE",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  instagram: "Instagram",
  twitter: "X",
  linkedin: "LinkedIn",
  google: "Google",
  gmail: "Gmail",
  outlook: "Outlook",
  eight: "Eight (名刺)",
  nengajo: "年賀状",
  csv: "CSV",
  vcard: "vCard",
  manual: "手入力",
  import: "書類・写真の取り込み",
  event: "パーティ・イベント",
  market: "掲示板",
  lms: "LMS",
  zentrack: "禅トラック",
  sns: "SNS",
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [name, setName] = useState("");
  const [distance, setDistance] = useState("3");
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);
  // パーティ・イベントのニューカマー取込 (どこで・いつ出会ったかを添えて迎える)
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [newcomerText, setNewcomerText] = useState("");
  const [newcomerResult, setNewcomerResult] = useState("");
  // 実行待ち (受け入れた提案の在庫)。ホームの提案を受け入れたらここに貯まり、
  // 実際に動きやすい形 (種類別 + 実行の近道つき) で並ぶ。
  const [actionItems, setActionItems] = useState<
    { id: string; kind: string; kindLabel: string; title: string; note: string | null; contactId: string | null; name: string | null; email: string | null }[]
  >([]);
  const [manualAction, setManualAction] = useState("");
  // 最近の動き (最近お迎えした方・最近情報が新しくなった方)。AI 不要なので自動で読み込む
  const [recentContacts, setRecentContacts] = useState<{
    added: { contactId: string; name: string; company: string | null; email: string | null; addedAt: string; updatedAt: string }[];
    updated: { contactId: string; name: string; company: string | null; email: string | null; addedAt: string; updatedAt: string }[];
  } | null>(null);
  const [connectHint, setConnectHint] = useState(""); // SNS連携ボタンを押したときの手順案内
  const [dragOver, setDragOver] = useState(false);
  // 距離感の見直し提案 (やりとりから 1〜5 を推し量る)
  const [distanceSug, setDistanceSug] = useState<
    { contactId: string; name: string; current: number; suggested: number; reason: string }[]
  >([]);
  const [convText, setConvText] = useState("");
  const [showConv, setShowConv] = useState(false);
  // 引き合わせの提案 (気づかない一手)。AI を使うのでボタンで取りに行く。
  const [intros, setIntros] = useState<
    { personA: string; personB: string; reason: string; how: string; caution: string }[] | null
  >(null);
  const [introNote, setIntroNote] = useState("");
  // こじれ・疎遠の検知 (そっと気にかけたい関係)。AI 不要なので自動で読み込む。
  const [drift, setDrift] = useState<
    { contactId: string; name: string; kind: string; reason: string; daysSince: number }[]
  >([]);
  // 新しく迎えた方への「はじめの一手」(取り込んだきりの方)。AI 不要なので自動で読み込む。
  const [firstMoves, setFirstMoves] = useState<
    { contactId: string; name: string; kind: string; reason: string }[]
  >([]);
  // 会った直後のひとこと伺い (最近お会いした方)。AI 不要なので自動で読み込む。
  const [recentMet, setRecentMet] = useState<{ contactId: string; name: string; metAt: string }[]>([]);
  const [metNotes, setMetNotes] = useState<Record<string, string>>({});
  const [metSaved, setMetSaved] = useState<Record<string, boolean>>({});
  // 大切にしたい方々 (重要そうな方のピックアップ)。AI 不要なので自動で読み込む。
  // 距離感・関係の目標・ピン留め/外すをこの場でカスタムでき、以降の自動ケアはこの
  // 優先度に沿って動く。
  const [focusItems, setFocusItems] = useState<
    {
      contactId: string;
      name: string;
      company: string | null;
      reasons: string[];
      distance: number;
      focusPreference: string | null;
      goal: { purpose: string; targetDistance: number } | null;
    }[]
  >([]);
  // 関係を育てるとよい方々 + 距離の縮め方 (キャッチアップ・申し出・会う など)
  const [growthItems, setGrowthItems] = useState<
    {
      contactId: string;
      name: string;
      company: string | null;
      distance: number;
      reason: string;
      email: string | null;
      moves: { kind: string; label: string }[];
    }[]
  >([]);
  // あなたへの提案 (優先度に基づく自動ケアの受け箱)。実行するかはユーザーが選ぶ。
  const [careItems, setCareItems] = useState<
    { id: string; contactId: string; name: string; kind: string; body: string | null }[]
  >([]);
  // あなたが力になれること (申し出) と、ニーズが重なる連絡先のマッチング
  type Offering = {
    id: string;
    kind: string;
    kindLabel: string;
    title: string;
    description: string | null;
    maxDistance: number | null;
    active: boolean;
    published: boolean;
  };
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [offerInterests, setOfferInterests] = useState<
    { id: string; offeringTitle: string; offeringKindLabel: string; guestName: string; guestContact: string | null; message: string | null }[]
  >([]);
  const [marketUrl, setMarketUrl] = useState<string | null>(null);
  const [offerKinds, setOfferKinds] = useState<{ value: string; label: string }[]>([]);
  const [offerMatches, setOfferMatches] = useState<
    { offeringId: string; title: string; kindLabel: string; contacts: { contactId: string; name: string; reason: string }[] }[]
  >([]);
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [offerTitle, setOfferTitle] = useState("");
  const [offerKind, setOfferKind] = useState("help");
  const [offerDesc, setOfferDesc] = useState("");
  const [offerMaxDist, setOfferMaxDist] = useState("");
  const [showOfferImport, setShowOfferImport] = useState(false);
  const [offerImportText, setOfferImportText] = useState("");
  const [offeredTo, setOfferedTo] = useState<Record<string, boolean>>({}); // 申し出済みの印 (offeringId:contactId)
  // 提案の見送り (✖️)。消した提案は再表示しない (サーバに記録・記録そのものは消さない)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const isDismissed = (kind: string, key: string) => dismissed.has(`${kind}|${key}`);
  const dismissSuggestion = (kind: string, key: string) => {
    setDismissed((cur) => new Set(cur).add(`${kind}|${key}`));
    void apiFetch("relationship/dismissals", {
      method: "POST",
      body: JSON.stringify({ kind, key }),
    }).catch(() => null);
  };
  // みなさんの一覧は既定で畳む (大半は動かない名簿のため)。検索でいつでも探せる
  const [showAll, setShowAll] = useState(false);
  const [nameFilter, setNameFilter] = useState("");
  // サーバ検索 (全員が対象。名前・ふりがな・ローマ字・メール・電話・会社・メモ)。
  // 一覧 API は 500 件までのため、検索は必ずサーバに聞く。
  const [searchResults, setSearchResults] = useState<Contact[] | null>(null);
  const [totalContacts, setTotalContacts] = useState<number | null>(null);
  // 取り込み元での絞り込み (LINE・Facebook・Google・名刺など、迎えた経路ごとのリスト)
  const [sourceCounts, setSourceCounts] = useState<{ source: string; count: number }[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [sourceResults, setSourceResults] = useState<Contact[] | null>(null);
  const [sourceTotal, setSourceTotal] = useState<number | null>(null);
  const pickSource = async (s: string) => {
    if (sourceFilter === s) {
      setSourceFilter(null);
      setSourceResults(null);
      return;
    }
    setSourceFilter(s);
    setSourceResults(null);
    const res = await apiFetch(`contacts?source=${encodeURIComponent(s)}`);
    if (res.ok) {
      const b = await res.json();
      setSourceResults(b.contacts ?? []);
      setSourceTotal(typeof b.total === "number" ? b.total : null);
    }
  };
  useEffect(() => {
    if (!nameFilter.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await apiFetch(`contacts?q=${encodeURIComponent(nameFilter.trim())}`);
      if (res.ok) setSearchResults((await res.json()).contacts ?? []);
    }, 300);
    return () => clearTimeout(timer);
  }, [nameFilter]);
  // 関係の目標 (目標を持つ方の、差と次の一手)。AI 不要なので自動で読み込む。
  const [goalItems, setGoalItems] = useState<
    { contactId: string; name: string; purposeLabel: string; current: number; target: number; plan: { paceLabel: string; nextMove: string; overdue: boolean; progress: number } }[]
  >([]);
  // 1日1問 (今日のひとこと質問)。定型なので AI 不要・毎回無料。
  const [dailyQ, setDailyQ] = useState<{ contactId: string; name: string; question: string } | null>(null);
  const [dailyAnswer, setDailyAnswer] = useState("");
  const [dailySaved, setDailySaved] = useState(false);
  const [proposals, setProposals] = useState<
    { name: string; note: string; date: string | null; contactId: string | null; selected: boolean }[]
  >([]);
  const [icsUrl, setIcsUrl] = useState("");
  const [showCalendar, setShowCalendar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importMsg, setImportMsg] = useState(""); // 取り込み中などの進行表示 (何も出ない状態をなくす)
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // 同姓同名の確認 (null = 非表示)。既存の同名者を見せて「同じ人か別の人か」を選んでもらう
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const [pendingName, setPendingName] = useState("");
  // Google 連携 (null = 確認中)
  const [googleStatus, setGoogleStatus] = useState<{
    available: boolean;
    connected: boolean;
    extended?: boolean;
    mailRead?: boolean;
    email?: string | null;
    lastSyncNote?: string | null;
  } | null>(null);
  // 録音メモ (メール添付テキスト) からのタスクと課題
  type VoiceMemo = {
    id: string;
    subject: string | null;
    receivedAt: string | null;
    summary: string | null;
    tasks: { text: string; kind: string; done: boolean }[];
    excerpt: string | null;
    status: string;
  };
  const [voiceMemos, setVoiceMemos] = useState<VoiceMemo[]>([]);
  const [plaudBusy, setPlaudBusy] = useState(false);
  const [voicePaste, setVoicePaste] = useState("");
  // 軸検索 (影響力・専門性・価値観・誠実さ/評判)
  const [axis, setAxis] = useState<string | null>(null);
  const [axisItems, setAxisItems] = useState<
    { contactId: string; name: string; company: string | null; title: string | null; reasons: string[] }[]
  >([]);
  const [axisBusy, setAxisBusy] = useState(false);
  // 公人評価の確認待ち (保留。ユーザーが候補から選ぶ)
  const [ddSuggestions, setDdSuggestions] = useState<
    {
      id: string;
      contactId: string;
      name: string;
      company: string | null;
      title: string | null;
      candidates: { name: string; description: string }[];
    }[]
  >([]);
  // 贈り物の行事 (いま贈るとよい方)
  const [giftOccasions, setGiftOccasions] = useState<
    { kind: string; contactId: string | null; contactName: string | null; label: string; daysUntil: number; note: string }[]
  >([]);
  // やり取りの督促 (返すお約束・貸し借りで期日が近い/過ぎたもの)
  const [exReminders, setExReminders] = useState<
    { id: string; contactId: string; contactName?: string; title: string; daysUntil: number | null; overdue: boolean; note: string }[]
  >([]);
  // 名寄せ: 同じ人が二重登録されていそうな組
  type DupeMember = { id: string; name: string; company: string | null; email: string | null; phone: string | null };
  type DupeGroup = { key: string; reason: string; strong: boolean; members: DupeMember[] };
  const [dupeGroups, setDupeGroups] = useState<DupeGroup[]>([]);
  // 取り込みジョブ (ページを離れても続く。状況を見せて安心してもらう)
  type ImportJobRow = {
    id: string;
    kind: string;
    filename: string | null;
    status: string;
    imported: number;
    enriched: number;
    interactionsAdded: number;
    skipped: number;
    detail: string | null;
    updatedAt: string;
  };
  const [jobs, setJobs] = useState<ImportJobRow[]>([]);
  const pumpingRef = useRef(false);
  const jobTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const [cRes, sRes, pRes, gRes, dRes, eRes, xRes] = await Promise.all([
      apiFetch("contacts"),
      apiFetch("relationship/summary"),
      apiFetch("relationship/progress"),
      apiFetch("gifts/occasions"),
      apiFetch("contacts/duplicates"),
      apiFetch("exchanges"),
      apiFetch("relationship/dismissals"),
    ]);
    if (xRes.ok) {
      const xBody = (await xRes.json()) as { items: { kind: string; key: string }[] };
      setDismissed(new Set(xBody.items.map((x) => `${x.kind}|${x.key}`)));
    }
    if (cRes.ok) {
      const cBody = await cRes.json();
      setContacts(cBody.contacts);
      setTotalContacts(typeof cBody.total === "number" ? cBody.total : null);
    }
    if (sRes.ok) setSummary(await sRes.json());
    if (pRes.ok) setProgress(await pRes.json());
    if (gRes.ok) setGiftOccasions((await gRes.json()).occasions ?? []);
    if (dRes.ok) setDupeGroups((await dRes.json()).groups ?? []);
    if (eRes.ok) setExReminders((await eRes.json()).reminders ?? []);
    const distRes = await apiFetch("relationship/distance-suggestions");
    if (distRes.ok) setDistanceSug((await distRes.json()).suggestions ?? []);
    const driftRes = await apiFetch("relationship/drift");
    if (driftRes.ok) setDrift((await driftRes.json()).items ?? []);
    const fmRes = await apiFetch("relationship/first-moves");
    if (fmRes.ok) setFirstMoves((await fmRes.json()).moves ?? []);
    const rmRes = await apiFetch("relationship/recent-meetings");
    if (rmRes.ok) setRecentMet((await rmRes.json()).items ?? []);
    const glRes = await apiFetch("relationship/goals");
    if (glRes.ok) setGoalItems((await glRes.json()).items ?? []);
    const fcRes = await apiFetch("relationship/focus");
    if (fcRes.ok) setFocusItems((await fcRes.json()).items ?? []);
    const grRes = await apiFetch("relationship/growth");
    if (grRes.ok) setGrowthItems((await grRes.json()).items ?? []);
    const vmRes = await apiFetch("relationship/voice-memos");
    if (vmRes.ok) setVoiceMemos((await vmRes.json()).memos ?? []);
    const dsRes = await apiFetch("relationship/dd-suggestions");
    if (dsRes.ok) setDdSuggestions((await dsRes.json()).items ?? []);
    const csRes = await apiFetch("relationship/care-suggestions");
    if (csRes.ok) setCareItems((await csRes.json()).items ?? []);
    const dqRes = await apiFetch("relationship/daily-question");
    if (dqRes.ok) setDailyQ((await dqRes.json()).question ?? null);
    const ofRes = await apiFetch("offerings");
    if (ofRes.ok) {
      const ob = await ofRes.json();
      setOfferings(ob.offerings ?? []);
      setOfferKinds(ob.kinds ?? []);
    }
    const omRes = await apiFetch("relationship/offering-matches");
    if (omRes.ok) setOfferMatches((await omRes.json()).matches ?? []);
    const oiRes = await apiFetch("relationship/offering-interests");
    if (oiRes.ok) setOfferInterests((await oiRes.json()).interests ?? []);
    const soRes = await apiFetch("schedule/offers");
    if (soRes.ok) setMarketUrl((await soRes.json()).marketUrl ?? null);
    const acRes = await apiFetch("actions");
    if (acRes.ok) setActionItems((await acRes.json()).items ?? []);
    const rcRes = await apiFetch("relationship/recent-contacts");
    if (rcRes.ok) setRecentContacts(await rcRes.json());
    const scRes = await apiFetch("relationship/contact-sources");
    if (scRes.ok) setSourceCounts((await scRes.json()).items ?? []);
  }, []);

  // 実行待ちへの受け入れ・済み/見送り。受け入れは source キーで冪等 (二重に貯まらない)。
  const refreshActions = async () => {
    const res = await apiFetch("actions");
    if (res.ok) setActionItems((await res.json()).items ?? []);
  };
  const acceptAction = async (a: { kind: string; contactId?: string; title: string; note?: string; sourceKind: string; sourceKey: string }) => {
    const res = await apiFetch("actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(a),
    });
    if (res.ok) {
      setNotice(t("c_added_to_pending_notice"));
      await refreshActions();
    } else {
      setError(t("c_add_pending_failed"));
    }
  };
  const settleAction = async (id: string, status: "done" | "dismissed") => {
    setActionItems((prev) => prev.filter((x) => x.id !== id)); // 楽観更新 (押した瞬間に片付く)
    const res = await apiFetch(`actions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) await refreshActions();
  };
  const addManualAction = async () => {
    if (!manualAction.trim()) return;
    const res = await apiFetch("actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "other", title: manualAction.trim() }),
    });
    if (res.ok) {
      setManualAction("");
      await refreshActions();
    }
  };

  // 申し出の登録・削除、および「この方に申し出る」(やり取り台帳に favor として下書き記録)。
  const addOffering = async () => {
    if (!offerTitle.trim()) return;
    const res = await apiFetch("offerings", {
      method: "POST",
      body: JSON.stringify({
        title: offerTitle.trim(),
        kind: offerKind,
        description: offerDesc.trim() || undefined,
        maxDistance: offerMaxDist ? Number(offerMaxDist) : undefined,
      }),
    });
    if (res.ok) {
      setOfferTitle("");
      setOfferDesc("");
      setOfferMaxDist("");
      setShowOfferForm(false);
      setNotice(t("c_offering_registered"));
      await load();
    } else {
      setError(t("c_register_failed_retry"));
    }
  };
  const removeOffering = async (id: string) => {
    const res = await apiFetch(`offerings/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  };
  const [editOfferId, setEditOfferId] = useState<string | null>(null);
  const [editOffer, setEditOffer] = useState<{ title: string; kind: string; description: string; maxDistance: string }>({
    title: "",
    kind: "help",
    description: "",
    maxDistance: "",
  });
  const startEditOffering = (o: Offering) => {
    setEditOfferId(o.id);
    setEditOffer({ title: o.title, kind: o.kind, description: o.description ?? "", maxDistance: o.maxDistance ? String(o.maxDistance) : "" });
  };
  const saveEditOffering = async () => {
    if (!editOfferId || !editOffer.title.trim()) return;
    const res = await apiFetch(`offerings/${editOfferId}`, {
      method: "PUT",
      body: JSON.stringify({
        title: editOffer.title.trim(),
        kind: editOffer.kind,
        description: editOffer.description.trim() || undefined,
        maxDistance: editOffer.maxDistance ? Number(editOffer.maxDistance) : undefined,
      }),
    });
    if (res.ok) {
      setEditOfferId(null);
      setNotice(t("c_offering_updated"));
      await load();
    } else {
      setError(t("c_save_failed_now"));
    }
  };
  // 軸検索: 押した軸で連絡先を探す (もう一度押すと閉じる)
  const runAxisSearch = async (a: string) => {
    if (axis === a) {
      setAxis(null);
      setAxisItems([]);
      return;
    }
    setAxis(a);
    setAxisBusy(true);
    try {
      const res = await apiFetch(`relationship/axis-search?axis=${a}`);
      if (res.ok) setAxisItems((await res.json()).items ?? []);
      else setAxisItems([]);
    } finally {
      setAxisBusy(false);
    }
  };
  // 公人評価の保留の解決 (候補を選ぶ / 名前のまま / 評価しない)
  const resolveDdSuggestion = async (id: string, candidateIndex?: number) => {
    setDdSuggestions((cur) => cur.filter((s) => s.id !== id));
    const res = await apiFetch(`relationship/dd-suggestions/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify(typeof candidateIndex === "number" ? { candidateIndex } : {}),
    });
    if (res.ok) setNotice(t("c_dd_registered"));
    else setError(t("c_register_failed_now"));
  };
  const dismissDdSuggestion = async (id: string) => {
    setDdSuggestions((cur) => cur.filter((s) => s.id !== id));
    await apiFetch(`relationship/dd-suggestions/${id}/dismiss`, { method: "POST", body: "{}" }).catch(() => null);
  };
  // 録音メモ (メール添付テキスト) の読み込みとタスクの操作
  const syncPlaud = async () => {
    setPlaudBusy(true);
    setError("");
    try {
      const res = await apiFetch("relationship/sync-plaud", { method: "POST", body: JSON.stringify({ locale: currentLocale() }) });
      const b = await res.json().catch(() => ({}));
      if (res.ok) {
        setNotice(
          b.imported > 0
            ? `${t("c_plaud_loaded_a")}${b.imported}${t("c_plaud_loaded_b")}`
            : t("c_plaud_none"),
        );
        const vmRes = await apiFetch("relationship/voice-memos");
        if (vmRes.ok) setVoiceMemos((await vmRes.json()).memos ?? []);
      } else {
        setError(b.detail ?? t("c_load_failed_now"));
      }
    } finally {
      setPlaudBusy(false);
    }
  };
  // Plaud 以外の録音・文字起こしの取り込み口 (どのレコーダーのテキストでも貼り付けで入る)
  const addVoiceMemoText = async () => {
    const text = voicePaste.trim();
    if (!text) return;
    setPlaudBusy(true);
    setError("");
    try {
      const res = await apiFetch("relationship/voice-memos", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      const b = await res.json().catch(() => ({}));
      if (res.ok) {
        setVoicePaste("");
        setNotice(t("c_voice_added"));
        const vmRes = await apiFetch("relationship/voice-memos");
        if (vmRes.ok) setVoiceMemos((await vmRes.json()).memos ?? []);
      } else {
        setError(b.detail ?? t("c_load_failed_now"));
      }
    } finally {
      setPlaudBusy(false);
    }
  };
  const toggleMemoTask = async (memoId: string, taskIndex: number, done: boolean) => {
    setVoiceMemos((cur) =>
      cur.map((m) => (m.id === memoId ? { ...m, tasks: m.tasks.map((t, i) => (i === taskIndex ? { ...t, done } : t)) } : m)),
    );
    await apiFetch(`relationship/voice-memos/${memoId}`, { method: "PUT", body: JSON.stringify({ taskIndex, done }) }).catch(() => null);
  };
  const dismissMemo = async (memoId: string) => {
    setVoiceMemos((cur) => cur.filter((m) => m.id !== memoId));
    await apiFetch(`relationship/voice-memos/${memoId}`, { method: "PUT", body: JSON.stringify({ status: "dismissed" }) }).catch(() => null);
  };
  const digestMemo = async (memoId: string) => {
    const res = await apiFetch(`relationship/voice-memos/${memoId}/digest`, { method: "POST", body: JSON.stringify({ locale: currentLocale() }) });
    if (res.ok) {
      setNotice(t("c_tasks_digested"));
      const vmRes = await apiFetch("relationship/voice-memos");
      if (vmRes.ok) setVoiceMemos((await vmRes.json()).memos ?? []);
    } else {
      const b = await res.json().catch(() => ({}));
      setError(b.detail ?? t("c_digest_failed_now"));
    }
  };
  const connectMailRead = async () => {
    const res = await apiFetch("google/auth-url?scope=mailread");
    const b = await res.json().catch(() => ({}));
    if (res.ok && b.url) window.location.href = b.url;
    else setError(b.detail ?? t("c_connect_failed_now"));
  };
  const importOfferings = async () => {
    if (!offerImportText.trim()) return;
    const res = await apiFetch("offerings/import", {
      method: "POST",
      body: JSON.stringify({ text: offerImportText }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const parts = (body.byKind as { label: string; count: number }[] | undefined)?.map((b) => `${b.label} ${b.count}`) ?? [];
      setOfferImportText("");
      setShowOfferImport(false);
      setNotice(
        body.added > 0
          ? `${body.added}${t("c_offer_import_done_a")}${parts.join(t("c_sep"))}${t("c_offer_import_done_b")}`
          : t("c_offer_import_none"),
      );
      await load();
    } else {
      setError(body.detail ?? t("c_import_failed_now"));
    }
  };
  const toggleOfferingPublished = async (id: string, published: boolean) => {
    const res = await apiFetch(`offerings/${id}`, { method: "PUT", body: JSON.stringify({ published }) });
    if (res.ok) {
      setNotice(published ? t("c_published_notice") : t("c_unpublished_notice"));
      await load();
    }
  };
  const approveInterest = async (id: string) => {
    const res = await apiFetch(`relationship/offering-interests/${id}/approve`, { method: "POST", body: "{}" });
    if (res.ok) {
      setNotice(t("c_interest_approved"));
      await load();
    }
  };
  const dismissInterest = async (id: string) => {
    const res = await apiFetch(`relationship/offering-interests/${id}/dismiss`, { method: "POST", body: "{}" });
    if (res.ok) await load();
  };
  const offerToContact = async (offeringId: string, contactId: string, title: string, kindLabel: string) => {
    const res = await apiFetch(`contacts/${contactId}/exchanges`, {
      method: "POST",
      body: JSON.stringify({ kind: "favor", direction: "outbound", status: "open", title: `${title}（${kindLabel}）を申し出` }),
    });
    if (res.ok) {
      setOfferedTo((s) => ({ ...s, [`${offeringId}:${contactId}`]: true }));
      setNotice(t("c_offer_recorded"));
      // 受け入れた申し出は実行待ちにも入れて、連絡の実行を忘れないようにする
      await acceptAction({
        kind: "offer",
        contactId,
        title: `${title}を申し出る連絡をする`,
        sourceKind: "offering",
        sourceKey: `${offeringId}:${contactId}`,
      });
    } else {
      setError(t("c_record_failed_retry"));
    }
  };

  // 優先リストのその場カスタム — 距離感・関係の目標・ピン留め/外す。
  // ここで決めた内容に沿って、以降の自動ケア (提案・材料整理) が動く。
  const saveFocusDistance = async (contactId: string, distance: number) => {
    const res = await apiFetch(`contacts/${contactId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ distance }),
    });
    if (res.ok) {
      setNotice(t("c_distance_saved"));
      await load();
    }
  };
  const saveFocusGoal = async (contactId: string, purpose: string, targetDistance: number) => {
    const res = purpose
      ? await apiFetch(`contacts/${contactId}/goal`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose, targetDistance }),
        })
      : await apiFetch(`contacts/${contactId}/goal`, { method: "DELETE" });
    if (res.ok) {
      setNotice(purpose ? t("c_goal_set") : t("c_goal_removed"));
      await load();
    }
  };
  const saveFocusPreference = async (contactId: string, preference: string | null) => {
    const res = await apiFetch(`contacts/${contactId}/focus-preference`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preference }),
    });
    if (res.ok) {
      setNotice(
        preference === "excluded"
          ? t("c_excluded_notice")
          : preference === "pinned"
            ? t("c_pinned_notice")
            : t("c_auto_notice"),
      );
      await load();
    }
  };
  const resolveCare = async (id: string, status: "done" | "dismissed") => {
    const res = await apiFetch(`relationship/care-suggestions/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) setCareItems((cur) => cur.filter((x) => x.id !== id));
  };

  // ひとことメモを相手に還流する (接触記録 + 論点整理の自動更新)
  const saveQuickNote = useCallback(async (contactId: string, text: string): Promise<boolean> => {
    if (!text.trim()) return false;
    const res = await apiFetch(`contacts/${contactId}/note`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  }, []);

  const loadJobs = useCallback(async (): Promise<number> => {
    const res = await apiFetch("contacts/import-jobs");
    if (!res.ok) return 0;
    const b = await res.json().catch(() => ({ jobs: [], active: 0 }));
    setJobs(b.jobs ?? []);
    return Number(b.active ?? 0);
  }, []);

  // 待ち行列をサーバに処理させ、状況を更新し、残っていれば少し後にまた処理する。
  // クライアントが離れても、走っている run はサーバ側で完了し、残りは毎時 sweep が拾う。
  const pumpJobs = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    const step = async () => {
      try {
        await apiFetch("contacts/import-jobs/run", { method: "POST" });
      } catch {
        // 通信断でもサーバ側 sweep が最後まで処理する
      }
      const active = await loadJobs();
      await load();
      if (active > 0) {
        jobTimerRef.current = setTimeout(() => void step(), 3000);
      } else {
        pumpingRef.current = false;
        jobTimerRef.current = null;
      }
    };
    await step();
  }, [loadJobs, load]);

  // 一組を先頭の人にまとめる (残りを統合)。まとめたら再読み込み。
  // まとめる / 別人として扱う は、数千件の全再読込を待たせず「押した瞬間に行が消える」
  // 楽観更新にする (以前は await load() で全連絡先を引き直していたため、モバイルで
  // 反応が固まって見えた)。失敗したときだけ行を戻して知らせる。
  const mergeGroup = async (g: DupeGroup) => {
    if (g.members.length < 2) return;
    setError("");
    setDupeGroups((prev) => prev.filter((x) => x.key !== g.key));
    try {
      const res = await apiFetch("contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId: g.members[0]!.id, otherIds: g.members.slice(1).map((m) => m.id) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDupeGroups((prev) => [g, ...prev]);
        setError(body.detail ?? t("c_merge_failed"));
        return;
      }
      setNotice(`${g.members.length}${t("c_merged_notice")}`);
      setTotalContacts((n) => (typeof n === "number" ? Math.max(0, n - (g.members.length - 1)) : n));
    } catch {
      setDupeGroups((prev) => [g, ...prev]);
      setError(t("c_merge_failed"));
    }
  };

  // 別の方として扱う: 名寄せの提案を見送り、この組は二度と出さない (サーバに記録)。
  const markDifferentPeople = async (g: DupeGroup) => {
    setError("");
    setDupeGroups((prev) => prev.filter((x) => x.key !== g.key));
    try {
      const res = await apiFetch("relationship/dismissals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "dupe", key: g.key }),
      });
      if (!res.ok) {
        setDupeGroups((prev) => [g, ...prev]);
        setError(t("c_save_failed_now"));
        return;
      }
      setNotice(t("c_marked_different"));
    } catch {
      setDupeGroups((prev) => [g, ...prev]);
      setError(t("c_save_failed_now"));
    }
  };

  // Google 連携のお相手取り込み (「いま取り込む」と、つないだ直後の自動取り込みで共用)。
  const syncGoogle = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    setError("");
    setNotice(t("c_google_syncing"));
    try {
      const res = await apiFetch("google/sync", { method: "POST", body: "{}" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice("");
        setError(body.detail ?? t("c_import_failed_now"));
        return;
      }
      const dup =
        Array.isArray(body.sameName) && body.sameName.length > 0
          ? `${t("c_same_name_skipped")}${body.sameName.slice(0, 5).join(t("c_comma"))}`
          : "";
      setNotice(`${t("c_google_synced_a")}${body.imported ?? 0}${t("c_google_synced_b")}${body.interactionsAdded ?? 0}${t("c_google_synced_c")}${dup}`);
      await load();
      const s = await apiFetch("google/status");
      if (s.ok) setGoogleStatus(await s.json());
    } finally {
      pumpingRef.current = false;
    }
  }, [load]);

  useEffect(() => {
    void load();
    void (async () => {
      const res = await apiFetch("google/status");
      setGoogleStatus(res.ok ? await res.json() : { available: false, connected: false });
    })();
    // 前回の取り込みが途中なら状況を出して再開する (ページを離れて戻ってきても続く)
    void (async () => {
      const active = await loadJobs();
      if (active > 0) void pumpJobs();
    })();
    // Google 同意画面から戻ってきたときの案内 (アドレスからは印を消す)
    const params = new URLSearchParams(window.location.search);
    const g = params.get("google");
    if (g) {
      if (g === "error") setError(t("c_google_error"));
      params.delete("google");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
      // つないだ直後は、その場で自動で取り込む (ワンタップで完了 = 極めて簡単に)
      if (g === "connected") void syncGoogle();
    }
    // スマホの「共有」から送られたファイルを受け付けたあと (Web Share Target)
    const shared = params.get("shared");
    if (shared !== null) {
      const n = parseInt(shared, 10) || 0;
      if (n > 0) {
        setNotice(`${n}${t("c_shared_accepted")}`);
        void (async () => {
          await loadJobs();
          void pumpJobs();
        })();
      } else {
        setError(t("c_shared_failed"));
      }
      params.delete("shared");
      const qs2 = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs2 ? `?${qs2}` : ""));
    }
    return () => {
      if (jobTimerRef.current) clearTimeout(jobTimerRef.current);
    };
  }, [load, loadJobs, pumpJobs, syncGoogle]);

  const add = async (confirmNew = false) => {
    const targetName = confirmNew ? pendingName : name.trim();
    if (!targetName || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: targetName, distance: Number(distance), confirmNew }),
      });
      if (res.status === 409) {
        // 同じお名前の方が既にいる。まず「どの方のことか」を確かめてもらう
        const body = await res.json().catch(() => ({}));
        setPendingName(targetName);
        setDuplicates(Array.isArray(body.duplicates) ? body.duplicates : []);
        return;
      }
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).detail ?? t("c_add_failed"));
        return;
      }
      setName("");
      setDuplicates(null);
      setPendingName("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!importText.trim() || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // サーバに取り込みを預ける (処理はサーバ側で進む = ページを離れても続く)
      const res = await apiFetch("contacts/import-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: importText }),
      });
      const raw = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = {};
      }
      if (!res.ok) {
        const detail = (body.detail as string) || (body.error as string) || raw.slice(0, 200);
        setError(`${t("c_import_error_a")}${res.status})${detail ? `: ${detail}` : ""}`);
        return;
      }
      setImportText("");
      setShowImport(false);
      setNotice(t("c_import_accepted"));
      await loadJobs();
      void pumpJobs();
    } catch (e) {
      setError(`${t("c_import_exception")}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // パーティ・イベントで出会った方々の一括受け入れ。1 行 1 人 (名前と SNS の URL・メール
  // が混ざっていてよい) の貼り付けを、イベント名と日付 (出会いの記録) を添えて迎える。
  const newcomerQuery = () =>
    eventName.trim()
      ? `&eventName=${encodeURIComponent(eventName.trim())}&eventDate=${encodeURIComponent(eventDate)}`
      : "";
  const runNewcomers = async () => {
    if (!newcomerText.trim() || busy) return;
    setBusy(true);
    setError("");
    setNewcomerResult("");
    try {
      const res = await apiFetch("contacts/newcomers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: newcomerText,
          eventName: eventName.trim() || undefined,
          eventDate,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(`${t("c_newcomer_error_a")}${res.status})${body.detail ? `: ${body.detail}` : ""}`);
        return;
      }
      const parts = [
        `${(body.imported as number) ?? 0}${t("c_newcomer_imported")}`,
        (body.enriched as number) > 0 ? `${body.enriched}${t("c_newcomer_enriched")}` : "",
        (body.skipped as number) > 0 ? `${body.skipped}${t("c_newcomer_skipped")}` : "",
      ].filter(Boolean);
      setNewcomerResult(`${parts.join(t("c_period"))}${t("c_newcomer_result_suffix")}`);
      setNewcomerText("");
      await load();
    } catch (e) {
      setError(`${t("c_import_exception")}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // ファイル/ZIP/フォルダの取り込み — SNS の「データをダウンロード」も、Word・Excel・PDF・
  // メールなどの書類も、フォルダごとでもそのまま放り込める。
  const MAX_UPLOAD_FILES = 200;
  // 動画・音声・実行ファイルなどは取り込めない。画像 (名刺・名簿・スクショ) は
  // Vision で読み取るので除外しない。
  const MEDIA_SKIP =
    /\.(mp4|mov|avi|mkv|webm|mp3|m4a|wav|aac|flac|ogg|exe|dll|dmg|apk|iso|woff2?|ttf|otf)$/i;

  // ドロップされたフォルダを再帰的にたどってファイルを集める (対応ブラウザのみ。
  // 非対応なら dataTransfer.files にフォールバック)
  const collectDropped = async (dt: DataTransfer): Promise<File[]> => {
    type FsEntry = {
      isFile: boolean;
      isDirectory: boolean;
      name: string;
      file: (ok: (f: File) => void, ng: (e: unknown) => void) => void;
      createReader: () => { readEntries: (ok: (es: FsEntry[]) => void, ng: (e: unknown) => void) => void };
    };
    const out: File[] = [];
    const walk = async (entry: FsEntry, path: string): Promise<void> => {
      if (out.length >= MAX_UPLOAD_FILES) return;
      if (entry.isFile) {
        if (entry.name.startsWith(".")) return;
        const file = await new Promise<File>((ok, ng) => entry.file(ok, ng)).catch(() => null);
        if (!file || file.size === 0 || file.size > 30 * 1024 * 1024 || MEDIA_SKIP.test(file.name)) return;
        out.push(new File([file], `${path}${file.name}`, { type: file.type }));
        return;
      }
      if (entry.isDirectory) {
        if (entry.name.startsWith(".") || entry.name === "__MACOSX") return;
        const reader = entry.createReader();
        for (;;) {
          const batch = await new Promise<FsEntry[]>((ok, ng) => reader.readEntries(ok, ng)).catch(() => []);
          if (batch.length === 0) break;
          for (const e of batch) await walk(e, `${path}${entry.name}/`);
        }
      }
    };
    const items = Array.from(dt.items ?? []);
    const entries = items
      .map((it) => (it.webkitGetAsEntry ? (it.webkitGetAsEntry() as FsEntry | null) : null))
      .filter((e): e is FsEntry => e !== null);
    if (entries.length === 0) return Array.from(dt.files);
    for (const e of entries) await walk(e, "");
    return out;
  };

  const uploadFiles = async (files: FileList | File[], extraQuery = "") => {
    if (busy) return;
    const list = Array.from(files)
      .filter((f) => f.size > 0 && !MEDIA_SKIP.test(f.name))
      .slice(0, MAX_UPLOAD_FILES);
    if (list.length === 0) {
      setError(t("c_no_readable_files"));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    // 各ファイルをサーバに預ける (預けるだけなので速い)。読み取りはサーバ側で進むため、
    // ここで預け終えればページを離れても取り込みは続く。
    let queued = 0;
    const problems: string[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i]!;
        const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        setImportMsg(`${t("c_uploading_a")}${i + 1}/${list.length}${t("c_uploading_b")}${path}`);
        try {
          const res = await apiFetch(`contacts/import-jobs?filename=${encodeURIComponent(path)}${extraQuery}`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: await file.arrayBuffer(),
          });
          if (res.ok) queued++;
          else {
            const b = await res.json().catch(() => ({}) as Record<string, unknown>);
            problems.push(`${path}: ${t("c_error_label")} ${res.status}${b.detail ? ` ${b.detail}` : ""}`);
          }
        } catch (e) {
          problems.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (queued > 0) {
        setNotice(
          `${queued}${t("c_files_accepted")}`,
        );
      }
      if (problems.length > 0) {
        setError(problems.slice(0, 5).join(" / ") + (problems.length > 5 ? ` ${t("c_and_more_a")}${problems.length - 5}${t("c_and_more_b")}` : ""));
      } else if (queued === 0) {
        setError(t("c_import_failed_retry"));
      }
      await loadJobs();
      void pumpJobs();
    } finally {
      setBusy(false);
      setImportMsg("");
    }
  };

  // 状況表示を片付ける (完了/失敗の行を消す)
  const clearJobs = async () => {
    await apiFetch("contacts/import-jobs/clear", { method: "POST" });
    await loadJobs();
  };

  // 会話やメモから登場人物と近況をさがす (提案どまり。反映はユーザーが選ぶ)
  const extractFromConversation = async () => {
    if (!convText.trim() || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setProposals([]);
    setImportMsg(t("c_conv_searching"));
    try {
      const res = await apiFetch("contacts/extract-from-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: convText, locale: currentLocale() }),
      });
      const raw = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = {};
      }
      if (!res.ok) {
        const detail = (body.detail as string) || (body.error as string) || raw.slice(0, 200);
        setError(`${t("c_conv_error_a")}${res.status})${detail ? `: ${detail}` : ""}`);
        return;
      }
      const list = (body.proposals ?? []) as { name: string; note: string; date: string | null; contactId: string | null }[];
      if (list.length === 0) {
        setNotice(t("c_conv_none"));
        return;
      }
      setProposals(list.map((p) => ({ ...p, selected: true })));
    } catch (e) {
      setError(`${t("c_conv_exception")}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setImportMsg("");
    }
  };

  const applyProposals = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    let applied = 0;
    try {
      for (const p of proposals.filter((x) => x.selected)) {
        let contactId = p.contactId;
        if (!contactId) {
          const res = await apiFetch("contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: p.name, distance: 4, personalProfile: p.note || undefined }),
          });
          if (!res.ok) continue;
          contactId = ((await res.json()).contact as { id: string }).id;
        } else if (p.note) {
          // 既存の方は近況をプロフィールに書き足す (他の項目は保ったまま)
          const cur = await apiFetch(`contacts/${contactId}`);
          if (cur.ok) {
            const contact = (await cur.json()).contact as Record<string, unknown>;
            const today = new Date().toISOString().slice(0, 10);
            const merged = [contact.personalProfile, `${today} ${p.note}`].filter(Boolean).join("\n");
            await apiFetch(`contacts/${contactId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...contact, personalProfile: merged }),
            });
          }
        }
        if (p.date && contactId) {
          await apiFetch(`contacts/${contactId}/interactions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "meeting", occurredAt: p.date }),
          });
        }
        applied++;
      }
      setNotice(`${applied}${t("c_applied_notice")}`);
      setProposals([]);
      setConvText("");
      setShowConv(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const logContact = async (contactId: string) => {
    await apiFetch(`contacts/${contactId}/interactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "message" }),
    });
    setNotice(t("c_contact_logged"));
    await load();
  };

  const level = LEVEL_LABEL[summary?.isolation.level ?? "unknown"] ?? LEVEL_LABEL.unknown!;

  // 提案の行の ✖️ (見送り)。押すとその提案は消え、以降も再表示しない
  const dismissX = (label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{ marginLeft: "auto", flexShrink: 0, background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}
    >
      ×
    </button>
  );

  // 見送り済みを除いた表示用リスト (key に年や日付を含むものは次の機会にまた出る)
  const thisYear = new Date().getFullYear();
  const giftKey = (o: { kind: string; contactId: string | null; label: string }) =>
    `${o.kind}:${o.contactId ?? o.label}:${thisYear}`;
  const shownOccasions = giftOccasions.filter((o) => !isDismissed("gift_occasion", giftKey(o)));
  const shownExReminders = exReminders.filter((r) => !isDismissed("exchange_reminder", r.id));
  const shownDistanceSug = distanceSug.filter((s) => !isDismissed("distance", `${s.contactId}:${s.suggested}`));
  const shownDrift = drift.filter((d) => !isDismissed("drift", d.contactId));
  const shownGoalItems = goalItems.filter((g) => !isDismissed("goal_nudge", g.contactId));
  const shownRecentMet = recentMet.filter((m) => !isDismissed("recent_meeting", `${m.contactId}:${m.metAt}`));
  const shownFirstMoves = firstMoves.filter((m) => !isDismissed("first_move", m.contactId));
  const shownGrowth = growthItems.filter((g) => !isDismissed("growth", g.contactId)).slice(0, 8);
  const todayKey = new Date().toISOString().slice(0, 10);
  const dailyQDismissed = dailyQ ? isDismissed("daily_question", `${dailyQ.contactId}:${todayKey}`) : false;

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <LanguageSelector />
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <Link href="/settings" style={{ color: "#64748b", fontSize: 14 }}>{t("c_settings")}</Link>
          <AuthBar />
        </div>
      </div>
      <p style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Link href="/" style={{ color: "#2563eb" }}>{t("back_home")}</Link>
        <Link href="/schedule" style={{ color: "#2563eb" }}>{t("c_nav_schedule")}</Link>
        <Link href="/campaigns" style={{ color: "#2563eb" }}>{t("c_nav_campaigns")}</Link>
        <Link href="/resources" style={{ color: "#2563eb" }}>{t("c_nav_resources")}</Link>
      </p>
      <h1 style={{ fontSize: 24 }}>{t("contacts_title")}</h1>

      {/* 人物の検索はページの一番上に (オーナー指示 2026-07-21)。全員が対象のサーバ検索 */}
      <div style={{ margin: "12px 0 16px" }}>
        <input
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder={`お名前・ふりがな・ローマ字・メール・電話・会社などで探す${totalContacts ? ` (${totalContacts}名)` : ""}`}
          aria-label="人物を探す"
          style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", border: "2px solid #cbd5e1", borderRadius: 10, fontSize: 15 }}
        />
        {nameFilter.trim() && (
          <div style={{ marginTop: 8 }}>
            <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 8px" }}>
              {searchResults === null
                ? "探しています…"
                : `全員の中から ${searchResults.length} 名が見つかりました${searchResults.length >= 100 ? " (多いため先頭の100名まで)" : ""}`}
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
              {(searchResults ?? []).slice(0, 30).map((c) => (
                <li key={c.id} style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
                  <Link
                    href={`/contacts/${c.id}`}
                    style={{ flex: 1, display: "flex", justifyContent: "space-between", border: "1px solid #e2e8f0", background: "#fff", borderRadius: 10, padding: "10px 14px", textDecoration: "none", color: "inherit" }}
                  >
                    <span>
                      {c.name}
                      {c.company && <small style={{ color: "#64748b", marginLeft: 8 }}>{c.company}</small>}
                    </span>
                    <small style={{ color: "#64748b" }}>{DISTANCE_LABEL[c.distance] ?? ""}</small>
                  </Link>
                  {c.email && (
                    <a
                      href={`mailto:${c.email}`}
                      aria-label={`${c.name}さんにメールする`}
                      title="メールする"
                      style={{ display: "flex", alignItems: "center", padding: "0 12px", border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 10, textDecoration: "none", fontSize: 13, whiteSpace: "nowrap" }}
                    >
                      ✉ メール
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!nameFilter.trim() && sourceCounts.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: "#64748b", fontSize: 12 }}>迎えた経路で見る:</span>
              {sourceCounts.slice(0, 10).map((s) => (
                <button
                  key={s.source}
                  onClick={() => void pickSource(s.source)}
                  aria-pressed={sourceFilter === s.source}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: sourceFilter === s.source ? "1px solid #2563eb" : "1px solid #e2e8f0",
                    background: sourceFilter === s.source ? "#dbeafe" : "#fff",
                    color: sourceFilter === s.source ? "#1d4ed8" : "#475569",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {SOURCE_LABEL[s.source] ?? s.source} {s.count}
                </button>
              ))}
            </div>
            {sourceFilter && (
              <div style={{ marginTop: 8 }}>
                <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 8px" }}>
                  {sourceResults === null
                    ? "読み込んでいます…"
                    : `${SOURCE_LABEL[sourceFilter] ?? sourceFilter} から迎えた方 ${sourceTotal ?? sourceResults.length} 名 (新しい順${(sourceTotal ?? 0) > 500 ? "・先頭の500名まで" : ""})`}
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                  {(sourceResults ?? []).map((c) => (
                    <li key={c.id} style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
                      <Link
                        href={`/contacts/${c.id}`}
                        style={{ flex: 1, display: "flex", justifyContent: "space-between", border: "1px solid #e2e8f0", background: "#fff", borderRadius: 10, padding: "10px 14px", textDecoration: "none", color: "inherit" }}
                      >
                        <span>
                          {c.name}
                          {c.company && <small style={{ color: "#64748b", marginLeft: 8 }}>{c.company}</small>}
                        </span>
                      </Link>
                      {c.email && (
                        <a
                          href={`mailto:${c.email}`}
                          aria-label={`${c.name}さんにメールする`}
                          title="メールする"
                          style={{ display: "flex", alignItems: "center", padding: "0 12px", border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 10, textDecoration: "none", fontSize: 13, whiteSpace: "nowrap" }}
                        >
                          ✉ メール
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {summary && (
        <Fold k="cl0" defaultOpen={false} title={<>{t("connection_score")}</>} style={{
            borderLeft: `5px solid ${level.color}`,
            background: "#f8fafc",
            borderRadius: 12,
            padding: "12px 16px",
            margin: "16px 0",
          }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 28, color: level.color }}>
              {summary.connectionScore}
              <small style={{ fontSize: 14, color: "#64748b" }}>/100</small>
            </div>
          </div>
          <p style={{ margin: "4px 0", color: level.color }}>{t(level.label)}</p>
          <p style={{ margin: 0, color: "#334155" }}>{t(level.message)}</p>
        </Fold>
      )}

      {progress && progress.totalInteractions > 0 && (
        <Fold k="cl1" defaultOpen={false} title={<>{t("c_progress_title")}</>} style={{ background: "#f8fafc", borderRadius: 12, padding: "12px 16px", margin: "16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ color: "#334155" }}>
              {progress.streakDays > 0 ? `${progress.streakDays}${t("c_streak_suffix")}` : ""}
            </span>
          </div>
          <p style={{ margin: "6px 0", color: "#64748b" }}>
            {progress.badges.filter((b) => b.achieved).map((b) => b.label).join(" / ") || t("c_first_badge")}
          </p>
          {progress.nextMilestone && (
            <div>
              <p style={{ margin: "4px 0", color: "#334155", fontSize: 14 }}>
                {t("c_next_milestone_a")}{progress.nextMilestone.label}{t("c_next_milestone_b")}{progress.nextMilestone.target - progress.nextMilestone.current}{t("c_next_milestone_c")}
              </p>
              <div style={{ background: "#e2e8f0", borderRadius: 6, height: 8 }}>
                <div
                  style={{
                    width: `${Math.min(100, Math.round((progress.nextMilestone.current / progress.nextMilestone.target) * 100))}%`,
                    background: "#2563eb",
                    height: 8,
                    borderRadius: 6,
                  }}
                />
              </div>
            </div>
          )}
        </Fold>
      )}

      {summary && summary.today.length > 0 && (
        <Fold k="cl2" defaultOpen={false} title={<>{t("today_suggestion")}</>} style={{ margin: "16px 0" }}>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
            {summary.today.map((sug) => (
              <li
                key={sug.contactId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: "10px 14px",
                }}
              >
                <span>
                  <Link href={`/contacts/${sug.contactId}`} style={{ color: "#1d4ed8", fontWeight: 700, textDecoration: "none" }}>
                    {sug.name}
                  </Link>
                  {t("c_san")}
                  <span style={{ color: "#64748b", marginLeft: 8 }}>{sug.reason}</span>
                </span>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    onClick={() =>
                      void acceptAction({
                        kind: "email",
                        contactId: sug.contactId,
                        title: "近況伺いの連絡をする",
                        note: sug.reason,
                        sourceKind: "today",
                        sourceKey: sug.contactId,
                      })
                    }
                    style={{ padding: "6px 12px", border: "1px solid #d97706", color: "#92400e", background: "#fffbeb", borderRadius: 8, cursor: "pointer" }}
                  >
                    {t("c_add_to_pending")}
                  </button>
                  <button
                    onClick={() => void logContact(sug.contactId)}
                    style={{
                      padding: "6px 12px",
                      border: "1px solid #2563eb",
                      color: "#2563eb",
                      background: "#fff",
                      borderRadius: 8,
                      cursor: "pointer",
                    }}
                  >
                    {t("contacted")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Fold>
      )}
      {summary && summary.today.length === 0 && contacts.length > 0 && (
        <p style={{ color: "#27ae60" }}>{t("c_all_connected")}</p>
      )}

      <Fold k="cl28" defaultOpen={false} title={<>{t("c_pending_title")}{actionItems.length > 0 ? ` (${actionItems.length})` : ""}</>} style={{ margin: "16px 0", border: "2px solid #f59e0b", background: "#fffbeb", borderRadius: 12, padding: "12px 16px" }}>
        <p style={{ fontSize: 13, color: "#92400e", margin: "4px 0 10px", lineHeight: 1.7 }}>
          {t("c_pending_desc")}
        </p>
        {actionItems.length === 0 && (
          <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 8px" }}>
            {t("c_pending_empty")}
          </p>
        )}
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {actionItems.map((a) => (
            <li key={a.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, border: "1px solid #fde68a", background: "#fff", borderRadius: 10, padding: "8px 12px", fontSize: 14 }}>
              <span style={{ fontSize: 12, color: "#92400e", background: "#fef3c7", borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>
                {a.kindLabel}
              </span>
              <span style={{ flex: 1, minWidth: 180 }}>
                {a.contactId && a.name && (
                  <Link href={`/contacts/${a.contactId}`} style={{ color: "#b45309", fontWeight: 700, marginRight: 6 }}>
                    {a.name}
                  </Link>
                )}
                {a.title}
                {a.note && <span style={{ color: "#78716c", fontSize: 12 }}> — {a.note}</span>}
              </span>
              {a.kind === "email" && a.email ? (
                <a href={`mailto:${a.email}`} style={{ padding: "5px 12px", border: "1px solid #f59e0b", background: "#fef3c7", color: "#92400e", borderRadius: 8, textDecoration: "none", fontSize: 13 }}>
                  ✉ {t("c_send_email")}
                </a>
              ) : a.contactId ? (
                <Link href={`/contacts/${a.contactId}`} style={{ padding: "5px 12px", border: "1px solid #f59e0b", background: "#fef3c7", color: "#92400e", borderRadius: 8, textDecoration: "none", fontSize: 13 }}>
                  {a.kind === "meet" ? t("c_decide_schedule") : a.kind === "gift" ? t("c_choose_gift") : a.kind === "email" ? t("c_compose_message") : t("c_go_contact_page")}
                </Link>
              ) : a.kind === "meet" ? (
                <Link href="/schedule" style={{ padding: "5px 12px", border: "1px solid #f59e0b", background: "#fef3c7", color: "#92400e", borderRadius: 8, textDecoration: "none", fontSize: 13 }}>
                  {t("c_open_schedule")}
                </Link>
              ) : null}
              <button
                onClick={() => void settleAction(a.id, "done")}
                style={{ padding: "5px 12px", background: "#d97706", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
              >
                {t("c_done_btn")}
              </button>
              {dismissX(`${a.title}${t("c_dismiss_suffix")}`, () => settleAction(a.id, "dismissed"))}
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input
            value={manualAction}
            onChange={(e) => setManualAction(e.target.value)}
            placeholder={t("c_manual_action_ph")}
            style={{ flex: "1 1 220px", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8 }}
          />
          <button
            onClick={() => void addManualAction()}
            disabled={!manualAction.trim()}
            style={{ padding: "8px 14px", border: "1px solid #d97706", color: "#92400e", background: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
          >
            {t("c_add_note_btn")}
          </button>
        </div>
      </Fold>

      {recentContacts && (recentContacts.added.length > 0 || recentContacts.updated.length > 0) && (
        <Fold k="cl29" defaultOpen={false} title={<>最近の動き (お迎えした方・情報が新しくなった方)</>} style={{ margin: "16px 0", border: "1px solid #a5b4fc", background: "#eef2ff", borderRadius: 12, padding: "12px 16px" }}>
          {recentContacts.added.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: "#3730a3", fontWeight: 700, margin: "0 0 6px" }}>最近お迎えした方 (登録した方)</p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                {recentContacts.added.map((r) => (
                  <li key={r.contactId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, flexWrap: "wrap" }}>
                    <Link href={`/contacts/${r.contactId}`} style={{ color: "#4338ca", fontWeight: 600, textDecoration: "none" }}>
                      {r.name}
                    </Link>
                    {r.company && <span style={{ color: "#94a3b8", fontSize: 12 }}>{r.company}</span>}
                    <span style={{ color: "#64748b", fontSize: 12, marginLeft: "auto" }}>
                      {new Date(r.addedAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })} に登録
                    </span>
                    {r.email && (
                      <a href={`mailto:${r.email}`} aria-label={`${r.name}さんにメールする`} style={{ color: "#1d4ed8", fontSize: 13, textDecoration: "none" }}>
                        ✉
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {recentContacts.updated.length > 0 && (
            <div>
              <p style={{ fontSize: 13, color: "#3730a3", fontWeight: 700, margin: "0 0 6px" }}>最近、情報が新しくなった方</p>
              <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 6px" }}>
                あなたの編集・取り込み・自動の整理などで、この方のページが更新されています。
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                {recentContacts.updated.map((r) => (
                  <li key={r.contactId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, flexWrap: "wrap" }}>
                    <Link href={`/contacts/${r.contactId}`} style={{ color: "#4338ca", fontWeight: 600, textDecoration: "none" }}>
                      {r.name}
                    </Link>
                    {r.company && <span style={{ color: "#94a3b8", fontSize: 12 }}>{r.company}</span>}
                    <span style={{ color: "#64748b", fontSize: 12, marginLeft: "auto" }}>
                      {new Date(r.updatedAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })} に更新
                    </span>
                    {r.email && (
                      <a href={`mailto:${r.email}`} aria-label={`${r.name}さんにメールする`} style={{ color: "#1d4ed8", fontSize: 13, textDecoration: "none" }}>
                        ✉
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Fold>
      )}

      {shownOccasions.length > 0 && (
        <Fold k="cl3" defaultOpen={false} title={<>{t("c_gift_occasions_title")}</>} style={{ margin: "16px 0", border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 12, padding: "12px 16px" }}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {shownOccasions.slice(0, 8).map((o, i) => (
              <li key={i} style={{ fontSize: 14, display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ flex: 1 }}>
                  {o.contactId ? (
                    <Link href={`/contacts/${o.contactId}`} style={{ color: "#b45309", fontWeight: 600 }}>
                      {o.label}
                    </Link>
                  ) : (
                    <span style={{ fontWeight: 600 }}>{o.label}</span>
                  )}
                  <span style={{ color: "#78716c" }}> — {o.note}</span>
                </span>
                <button
                  onClick={() =>
                    void acceptAction({
                      kind: "gift",
                      contactId: o.contactId ?? undefined,
                      title: o.label,
                      note: o.note,
                      sourceKind: "gift_occasion",
                      sourceKey: giftKey(o),
                    })
                  }
                  aria-label={`${o.label}${t("c_add_pending_suffix")}`}
                  style={{ padding: "4px 10px", border: "1px solid #d97706", color: "#92400e", background: "#fffbeb", borderRadius: 8, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
                >
                  {t("c_add_to_pending")}
                </button>
                {dismissX(`${o.label}${t("c_dismiss_suffix")}`, () => dismissSuggestion("gift_occasion", giftKey(o)))}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {shownExReminders.length > 0 && (
        <Fold k="cl4" defaultOpen={false} title={<>{t("c_ex_reminders_title")}</>} style={{ margin: "16px 0", border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 12, padding: "12px 16px" }}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {shownExReminders.slice(0, 8).map((r) => (
              <li key={r.id} style={{ fontSize: 14, display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ flex: 1 }}>
                  <Link href={`/contacts/${r.contactId}`} style={{ color: r.overdue ? "#b91c1c" : "#b45309", fontWeight: 600 }}>
                    {r.contactName ?? t("c_this_person")}: {r.title}
                  </Link>
                  <span style={{ color: "#78716c" }}> — {r.note}</span>
                </span>
                {dismissX(`${r.title}${t("c_dismiss_notice_suffix")}`, () => dismissSuggestion("exchange_reminder", r.id))}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {shownDistanceSug.length > 0 && (
        <Fold k="cl5" defaultOpen={false} title={<>{t("c_distance_review_title")}</>} style={{ margin: "16px 0", border: "1px solid #bae6fd", background: "#f0f9ff", borderRadius: 12, padding: "12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <button
              style={{ padding: "6px 14px", background: "#0284c7", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                setError("");
                try {
                  const res = await apiFetch("relationship/apply-distances", { method: "POST", body: "{}" });
                  const body = await res.json().catch(() => ({}));
                  if (res.ok) setNotice(`${body.applied ?? 0}${t("c_distances_applied")}`);
                  await load();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("c_apply_all")}
            </button>
          </div>
          <p style={{ fontSize: 13, color: "#475569", margin: "6px 0" }}>
            {t("c_distance_review_desc")}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {shownDistanceSug.slice(0, 12).map((s) => (
              <li key={s.contactId} style={{ fontSize: 14, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <Link href={`/contacts/${s.contactId}`} style={{ color: "#0369a1", fontWeight: 600 }}>
                  {s.name}
                </Link>
                <span style={{ color: "#334155" }}>
                  {s.current}{t("c_from")}{s.suggested}{t("c_to_dist")}
                </span>
                <span style={{ color: "#64748b" }}>— {s.reason}</span>
                <button
                  style={{ padding: "2px 10px", background: "#fff", color: "#0284c7", border: "1px solid #0284c7", borderRadius: 8, cursor: "pointer", fontSize: 12 }}
                  disabled={busy}
                  onClick={async () => {
                    const res = await apiFetch("relationship/apply-distances", {
                      method: "POST",
                      body: JSON.stringify({ ids: [s.contactId] }),
                    });
                    if (res.ok) {
                      setNotice(`${s.name}${t("c_distance_set_a")}${s.suggested}${t("c_distance_set_b")}`);
                      await load();
                    }
                  }}
                >
                  {t("c_apply_one")}
                </button>
                {dismissX(`${s.name}${t("c_dismiss_distance_suffix")}`, () => dismissSuggestion("distance", `${s.contactId}:${s.suggested}`))}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {shownDrift.length > 0 && (
        <Fold k="cl6" defaultOpen={false} title={<>{t("c_drift_title")}</>} style={{ margin: "16px 0", border: "1px solid #fed7aa", background: "#fff7ed", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#9a3412", margin: "4px 0 8px" }}>
            {t("c_drift_desc")}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {shownDrift.map((d) => (
              <li key={d.contactId} style={{ fontSize: 14, display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ flex: 1 }}>
                  <Link href={`/contacts/${d.contactId}`} style={{ color: "#c2410c", fontWeight: 600 }}>
                    {d.name}
                  </Link>
                  <span style={{ color: "#7c2d12" }}> — {d.reason}</span>
                </span>
                {dismissX(`${d.name}${t("c_dismiss_drift_suffix")}`, () => dismissSuggestion("drift", d.contactId))}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {focusItems.length > 0 && (
        <Fold k="cl7" defaultOpen={false} title={<>{t("c_focus_title")}</>} style={{ margin: "16px 0", border: "2px solid #fbbf24", background: "#fffbeb", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#92400e", margin: "4px 0 8px" }}>
            {t("c_focus_desc")}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {focusItems.map((f) => (
              <li key={f.contactId} style={{ fontSize: 14, borderBottom: "1px solid #fde68a", paddingBottom: 8 }}>
                <div>
                  <Link href={`/contacts/${f.contactId}`} style={{ color: "#b45309", fontWeight: 600 }}>
                    {f.name}
                  </Link>
                  {f.company && <small style={{ color: "#92400e", marginLeft: 6 }}>{f.company}</small>}
                  {f.reasons.length > 0 && <span style={{ color: "#78350f", fontSize: 12, marginLeft: 8 }}>{f.reasons.join(t("c_sep"))}</span>}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <label style={{ fontSize: 12, color: "#92400e" }}>
                    {t("c_distance_label")}{" "}
                    <select
                      value={f.distance}
                      aria-label={`${f.name}${t("c_aria_distance_suffix")}`}
                      onChange={(e) => void saveFocusDistance(f.contactId, Number(e.target.value))}
                      style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #fcd34d", fontSize: 13 }}
                    >
                      <option value={1}>{t("c_dist_opt1")}</option>
                      <option value={2}>{t("c_dist_opt2")}</option>
                      <option value={3}>{t("c_dist_opt3")}</option>
                      <option value={4}>{t("c_dist_opt4")}</option>
                      <option value={5}>{t("c_dist_opt5")}</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 12, color: "#92400e" }}>
                    {t("c_goal_label")}{" "}
                    <select
                      value={f.goal?.purpose ?? ""}
                      aria-label={`${f.name}${t("c_aria_goal_suffix")}`}
                      onChange={(e) => void saveFocusGoal(f.contactId, e.target.value, f.goal?.targetDistance ?? Math.max(1, f.distance - 1))}
                      style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #fcd34d", fontSize: 13 }}
                    >
                      <option value="">{t("c_goal_none")}</option>
                      <option value="business">{t("c_goal_business")}</option>
                      <option value="friend">{t("c_goal_friend")}</option>
                      <option value="romance">{t("c_goal_romance")}</option>
                      <option value="family">{t("c_goal_family")}</option>
                      <option value="community">{t("c_goal_community")}</option>
                      <option value="other">{t("c_other")}</option>
                    </select>
                  </label>
                  {f.goal && (
                    <label style={{ fontSize: 12, color: "#92400e" }}>
                      {t("c_target_distance_label")}{" "}
                      <select
                        value={f.goal.targetDistance}
                        aria-label={`${f.name}${t("c_aria_target_suffix")}`}
                        onChange={(e) => void saveFocusGoal(f.contactId, f.goal!.purpose, Number(e.target.value))}
                        style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #fcd34d", fontSize: 13 }}
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <span style={{ flex: 1 }} />
                  <button
                    onClick={() => void saveFocusPreference(f.contactId, f.focusPreference === "pinned" ? null : "pinned")}
                    style={{ background: "none", border: "1px solid #fcd34d", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12, color: "#92400e" }}
                  >
                    {f.focusPreference === "pinned" ? t("c_unpin") : t("c_pin")}
                  </button>
                  <button
                    onClick={() => void saveFocusPreference(f.contactId, "excluded")}
                    style={{ background: "none", border: "none", color: "#a16207", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
                  >
                    {t("c_exclude_btn")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {careItems.length > 0 && (
        <Fold k="cl21" defaultOpen={false} title={<>{t("c_care_title")} ({careItems.length}{t("c_count_items")})</>} style={{ margin: "16px 0", border: "1px solid #a5b4fc", background: "#eef2ff", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#3730a3", margin: "4px 0 8px" }}>
            {t("c_care_desc")}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {careItems.map((s) => (
              <li key={s.id} style={{ fontSize: 14 }}>
                <div style={{ color: "#312e81", lineHeight: 1.7 }}>{s.body}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4, alignItems: "center" }}>
                  {s.kind === "import_talk" ? (
                    <button
                      onClick={() => {
                        setShowImport(true);
                        setNotice(t("c_import_talk_hint"));
                      }}
                      style={{ background: "none", border: "none", color: "#4338ca", cursor: "pointer", fontSize: 13, textDecoration: "underline", padding: 0 }}
                    >
                      {t("c_go_import")}
                    </button>
                  ) : (
                    <Link href={`/contacts/${s.contactId}`} style={{ color: "#4338ca", fontSize: 13 }}>
                      {s.kind === "reach_out" ? t("c_care_reach_out") : s.kind === "meet" ? t("c_care_meet") : s.kind === "set_goal" ? t("c_set_goal") : t("c_go_contact_page")}
                    </Link>
                  )}
                  <button onClick={() => void resolveCare(s.id, "done")} style={{ background: "none", border: "none", color: "#166534", cursor: "pointer", fontSize: 12, padding: 0 }}>
                    {t("c_did_it")}
                  </button>
                  <button onClick={() => void resolveCare(s.id, "dismissed")} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 12, padding: 0 }}>
                    {t("c_skip_this_time")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {shownGrowth.length > 0 && (
        <Fold k="cl23" defaultOpen={false} title={<>{t("c_growth_title")}</>} style={{ margin: "16px 0", border: "2px solid #34d399", background: "#ecfdf5", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#065f46", margin: "4px 0 10px" }}>
            {t("c_growth_desc")}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
            {shownGrowth.map((g) => (
              <li key={g.contactId} style={{ border: "1px solid #a7f3d0", borderRadius: 10, padding: "10px 12px", background: "#fff" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <Link href={`/contacts/${g.contactId}`} style={{ color: "#047857", fontWeight: 700, textDecoration: "none" }}>
                    {g.name}
                  </Link>
                  {g.company && <span style={{ color: "#94a3b8", fontSize: 12 }}>{g.company}</span>}
                  <span style={{ color: "#059669", fontSize: 12 }}>{t("c_distance_prefix")}{g.distance}</span>
                  {dismissX(`${g.name}${t("c_dismiss_growth_suffix")}`, () => dismissSuggestion("growth", g.contactId))}
                </div>
                {g.reason && <p style={{ margin: "4px 0 8px", color: "#065f46", fontSize: 13 }}>{g.reason}</p>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {g.moves.map((mv, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                      {mv.kind === "catchup" && g.email ? (
                        <a
                          href={`mailto:${g.email}`}
                          style={{ padding: "5px 12px", border: "1px solid #6ee7b7", background: "#d1fae5", color: "#065f46", borderRadius: 8, textDecoration: "none", fontSize: 13 }}
                        >
                          ✉ {mv.label}
                        </a>
                      ) : (
                        <Link
                          href={`/contacts/${g.contactId}`}
                          style={{ padding: "5px 12px", border: "1px solid #6ee7b7", background: "#d1fae5", color: "#065f46", borderRadius: 8, textDecoration: "none", fontSize: 13 }}
                        >
                          {mv.label}
                        </Link>
                      )}
                      <button
                        onClick={() =>
                          void acceptAction({
                            kind: mv.kind === "catchup" ? "email" : mv.kind === "meet" ? "meet" : mv.kind === "offer" ? "offer" : "other",
                            contactId: g.contactId,
                            title: mv.label,
                            sourceKind: "growth_move",
                            sourceKey: `${g.contactId}:${mv.kind}`,
                          })
                        }
                        aria-label={`${g.name}${t("c_aria_move_a")}${mv.label}${t("c_aria_move_b")}`}
                        title={t("c_add_to_pending")}
                        style={{ padding: "4px 8px", border: "1px solid #d97706", color: "#92400e", background: "#fffbeb", borderRadius: 8, cursor: "pointer", fontSize: 12 }}
                      >
                        ＋
                      </button>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {/* 貼り付けの取り込み口は Google 連携が無くても使えるため、パネルは常時出す */}
      {(
        <Fold k="cl24" defaultOpen={false} title={<>{t("c_voice_title")}{voiceMemos.length > 0 ? ` (${voiceMemos.length})` : ""}</>} style={{ margin: "16px 0", border: "1px solid #c7d2fe", background: "#eef2ff", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#3730a3", margin: "4px 0 10px" }}>
            {t("c_voice_desc")}
          </p>
          {googleStatus?.available && googleStatus.connected && !googleStatus.mailRead ? (
            <div>
              <p style={{ fontSize: 13, color: "#475569", margin: "0 0 8px", lineHeight: 1.8 }}>
                {t("c_voice_need_permission")}
              </p>
              <button
                onClick={() => void connectMailRead()}
                style={{ padding: "8px 16px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
              >
                {t("c_voice_permit_btn")}
              </button>
            </div>
          ) : (
            <div>
              {googleStatus?.mailRead && (
                <button
                  onClick={() => void syncPlaud()}
                  disabled={plaudBusy}
                  style={{ padding: "6px 14px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, marginBottom: 10 }}
                >
                  {plaudBusy ? t("c_loading_progress") : t("c_load_now")}
                </button>
              )}
              {voiceMemos.length === 0 && (
                <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
                  {t("c_voice_empty")}
                </p>
              )}
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
                {voiceMemos.map((m) => (
                  <li key={m.id} style={{ border: "1px solid #ddd6fe", borderRadius: 10, padding: "10px 12px", background: "#fff" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>
                        {m.subject ?? t("c_voice_memo")}
                        {m.receivedAt && (
                          <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
                            {new Date(m.receivedAt).toLocaleDateString("ja-JP")}
                          </span>
                        )}
                      </span>
                      {dismissX(`${m.subject ?? t("c_this_voice_memo")}${t("c_dismiss_memo_suffix")}`, () => void dismissMemo(m.id))}
                    </div>
                    {m.summary && <p style={{ margin: "6px 0", color: "#334155", fontSize: 13, lineHeight: 1.7 }}>{m.summary}</p>}
                    {m.tasks.length > 0 ? (
                      <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "grid", gap: 4 }}>
                        {m.tasks.map((t2, i) => (
                          <li key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 14 }}>
                            <input
                              type="checkbox"
                              checked={t2.done}
                              onChange={(e) => void toggleMemoTask(m.id, i, e.target.checked)}
                              aria-label={`${t2.text}${t("c_aria_mark_done")}`}
                            />
                            <span style={{ textDecoration: t2.done ? "line-through" : "none", color: t2.done ? "#94a3b8" : "#0f172a" }}>
                              {t2.kind === "issue" && (
                                <span style={{ color: "#b45309", fontSize: 12, border: "1px solid #fcd34d", background: "#fffbeb", borderRadius: 6, padding: "1px 6px", marginRight: 6 }}>
                                  {t("c_issue_badge")}
                                </span>
                              )}
                              {t2.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ marginTop: 6 }}>
                        {m.excerpt && <p style={{ margin: "0 0 6px", color: "#64748b", fontSize: 13 }}>{m.excerpt}…</p>}
                        <button
                          onClick={() => void digestMemo(m.id)}
                          style={{ padding: "5px 12px", background: "#fff", color: "#4f46e5", border: "1px solid #c7d2fe", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                        >
                          {t("c_digest_btn")}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Plaud 以外の取り込み口: どのレコーダー・文字起こしアプリのテキストでも貼り付けで入る */}
          <div style={{ marginTop: 12, borderTop: "1px solid #c7d2fe", paddingTop: 10 }}>
            <p style={{ fontSize: 13, color: "#4338ca", margin: "0 0 6px" }}>{t("c_voice_paste_desc")}</p>
            <textarea
              value={voicePaste}
              onChange={(e) => setVoicePaste(e.target.value)}
              placeholder={t("c_voice_paste_ph")}
              rows={3}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #c7d2fe", borderRadius: 8, padding: 8, fontSize: 13 }}
            />
            <button
              onClick={() => void addVoiceMemoText()}
              disabled={plaudBusy || !voicePaste.trim()}
              style={{ marginTop: 6, padding: "6px 14px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
            >
              {plaudBusy ? t("c_loading_progress") : t("c_voice_paste_btn")}
            </button>
          </div>
        </Fold>
      )}

      {ddSuggestions.length > 0 && (
        <Fold k="cl26" defaultOpen={false} title={<>{t("c_dd_title")} ({ddSuggestions.length})</>} style={{ margin: "16px 0", border: "1px solid #f5d0fe", background: "#fdf4ff", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#86198f", margin: "4px 0 10px" }}>
            {t("c_dd_desc")}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
            {ddSuggestions.map((s) => (
              <li key={s.id} style={{ border: "1px solid #f0abfc", borderRadius: 10, padding: "10px 12px", background: "#fff" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <Link href={`/contacts/${s.contactId}`} style={{ color: "#a21caf", fontWeight: 700, textDecoration: "none", flex: 1 }}>
                    {s.name}
                  </Link>
                  {(s.company || s.title) && (
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>{[s.company, s.title].filter(Boolean).join(" ")}</span>
                  )}
                  {dismissX(`${s.name}${t("c_dismiss_dd_suffix")}`, () => void dismissDdSuggestion(s.id))}
                </div>
                {s.candidates.length > 0 ? (
                  <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                    <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>{t("c_dd_which")}</p>
                    {s.candidates.map((cand, i) => (
                      <button
                        key={i}
                        onClick={() => void resolveDdSuggestion(s.id, i)}
                        style={{ textAlign: "left", padding: "8px 10px", border: "1px solid #e9d5ff", background: "#faf5ff", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                      >
                        <span style={{ fontWeight: 600 }}>{cand.name}</span>
                        <span style={{ display: "block", color: "#64748b", marginTop: 2 }}>{cand.description}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: "8px 0 0", fontSize: 13, color: "#64748b" }}>
                    {t("c_dd_not_identified")}
                  </p>
                )}
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() => void resolveDdSuggestion(s.id)}
                    style={{ padding: "6px 12px", border: "1px solid #d8b4fe", background: "#fff", color: "#7e22ce", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                  >
                    {t("c_dd_eval_as_is")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {shownGoalItems.length > 0 && (
        <Fold k="cl8" defaultOpen={false} title={<>{t("c_goal_panel_title")}</>} style={{ margin: "16px 0", border: "1px solid #ddd6fe", background: "#faf5ff", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#6b21a8", margin: "4px 0 8px" }}>
            {t("c_goal_panel_desc")}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {shownGoalItems.map((g) => (
              <li key={g.contactId} style={{ fontSize: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ flex: 1 }}>
                    <Link href={`/contacts/${g.contactId}`} style={{ color: "#7c3aed", fontWeight: 600 }}>
                      {g.name}
                    </Link>
                    <span style={{ color: "#6b21a8", fontSize: 12, marginLeft: 6 }}>
                      {g.purposeLabel}{t("c_goal_now_a")}{g.current}{t("c_goal_now_b")}{g.target}
                      {g.plan.progress > 0 ? `${t("c_goal_progress_a")}${g.plan.progress}${t("c_goal_progress_b")}` : ""}
                      {g.plan.overdue ? t("c_goal_overdue") : ""}
                    </span>
                  </span>
                  {dismissX(`${g.name}${t("c_dismiss_goal_suffix")}`, () => dismissSuggestion("goal_nudge", g.contactId))}
                </div>
                <div style={{ color: "#4c1d95", marginTop: 2 }}>{g.plan.nextMove}</div>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {shownRecentMet.length > 0 && (
        <Fold k="cl9" defaultOpen={false} title={<>{t("c_recent_met_title")}</>} style={{ margin: "16px 0", border: "1px solid #bae6fd", background: "#f0f9ff", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#075985", margin: "4px 0 8px" }}>
            {t("c_recent_met_desc")}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {shownRecentMet.map((m) => (
              <li key={m.contactId} style={{ fontSize: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <Link href={`/contacts/${m.contactId}`} style={{ color: "#0369a1", fontWeight: 600 }}>
                  {m.name}
                </Link>
                <span style={{ color: "#0c4a6e", fontSize: 12 }}>{m.metAt}{t("c_met_on_suffix")}</span>
                {dismissX(`${m.name}${t("c_dismiss_recent_suffix")}`, () => dismissSuggestion("recent_meeting", `${m.contactId}:${m.metAt}`))}
                {metSaved[m.contactId] ? (
                  <span style={{ color: "#047857", fontSize: 13 }}>{t("c_note_saved_thanks")}</span>
                ) : (
                  <span style={{ display: "flex", gap: 6, flex: 1, minWidth: 220 }}>
                    <input
                      value={metNotes[m.contactId] ?? ""}
                      onChange={(e) => setMetNotes((s) => ({ ...s, [m.contactId]: e.target.value }))}
                      placeholder={t("c_met_note_ph")}
                      style={{ flex: 1, padding: "6px 8px", border: "1px solid #bae6fd", borderRadius: 8, fontSize: 13 }}
                    />
                    <button
                      style={{ padding: "6px 12px", background: "#0284c7", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                      onClick={async () => {
                        if (await saveQuickNote(m.contactId, metNotes[m.contactId] ?? "")) {
                          setMetSaved((s) => ({ ...s, [m.contactId]: true }));
                        }
                      }}
                    >
                      {t("c_save_note_btn")}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {dailyQ && !dailySaved && !dailyQDismissed && (
        <Fold k="cl10" defaultOpen={false} title={<>{t("c_daily_title")}</>} style={{ margin: "16px 0", border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 14, color: "#78350f", margin: "4px 0 8px" }}>{dailyQ.question}</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input
              value={dailyAnswer}
              onChange={(e) => setDailyAnswer(e.target.value)}
              placeholder={t("c_daily_ph")}
              style={{ flex: 1, minWidth: 220, padding: "6px 8px", border: "1px solid #fde68a", borderRadius: 8, fontSize: 13 }}
            />
            <button
              style={{ padding: "6px 14px", background: "#d97706", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
              onClick={async () => {
                if (await saveQuickNote(dailyQ.contactId, dailyAnswer)) {
                  setDailySaved(true);
                  setNotice(`${dailyQ.name}${t("c_daily_saved_suffix")}`);
                }
              }}
            >
              {t("c_save_note_btn")}
            </button>
            <button
              style={{ padding: "6px 10px", background: "transparent", color: "#92400e", border: "1px solid #fcd34d", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
              onClick={() => {
                setDailySaved(true);
                // 今日いっぱいは出さない (明日は別の一問がまた出る)
                dismissSuggestion("daily_question", `${dailyQ.contactId}:${todayKey}`);
              }}
            >
              {t("c_daily_skip")}
            </button>
          </div>
          <p style={{ fontSize: 12, color: "#92400e", margin: "8px 0 0" }}>
            {t("c_daily_footer")}
          </p>
        </Fold>
      )}

      {shownFirstMoves.length > 0 && (
        <Fold k="cl11" defaultOpen={false} title={<>{t("c_first_moves_title")}</>} style={{ margin: "16px 0", border: "1px solid #a7f3d0", background: "#ecfdf5", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#065f46", margin: "4px 0 8px" }}>
            {t("c_first_moves_desc")}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {shownFirstMoves.slice(0, 8).map((m) => (
              <li key={m.contactId} style={{ fontSize: 14, display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ flex: 1 }}>
                  <Link href={`/contacts/${m.contactId}`} style={{ color: "#047857", fontWeight: 600 }}>
                    {m.name}
                  </Link>
                  <span style={{ color: "#064e3b" }}> — {m.reason}</span>
                </span>
                {dismissX(`${m.name}${t("c_dismiss_first_move_suffix")}`, () => dismissSuggestion("first_move", m.contactId))}
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 12, color: "#047857", margin: "8px 0 0" }}>
            {t("c_first_moves_footer")}
          </p>
        </Fold>
      )}

      <Fold k="cl22" defaultOpen={false} title={<>{t("c_offerings_title")}</>} style={{ margin: "16px 0", border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 12, padding: "12px 16px" }}>
        <p style={{ fontSize: 13, color: "#166534", margin: "4px 0 8px" }}>
          {t("c_offerings_desc")}
        </p>
        {offerings.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", display: "grid", gap: 8 }}>
            {offerings.map((o) =>
              editOfferId === o.id ? (
                <li key={o.id} style={{ display: "grid", gap: 6, border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 12px", background: "#fff" }}>
                  <input
                    value={editOffer.title}
                    onChange={(e) => setEditOffer({ ...editOffer, title: e.target.value })}
                    aria-label={t("c_aria_offer_title")}
                    style={{ padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14 }}
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <select
                      aria-label={t("c_aria_offer_kind")}
                      value={editOffer.kind}
                      onChange={(e) => setEditOffer({ ...editOffer, kind: e.target.value })}
                      style={{ padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14 }}
                    >
                      {offerKinds.map((k) => (
                        <option key={k.value} value={k.value}>{k.label}</option>
                      ))}
                    </select>
                    <select
                      aria-label={t("c_aria_offer_range")}
                      value={editOffer.maxDistance}
                      onChange={(e) => setEditOffer({ ...editOffer, maxDistance: e.target.value })}
                      style={{ padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14 }}
                    >
                      <option value="">{t("c_range_anyone")}</option>
                      <option value="2">{t("c_range_2")}</option>
                      <option value="3">{t("c_range_3")}</option>
                      <option value="4">{t("c_range_4")}</option>
                    </select>
                  </div>
                  <input
                    value={editOffer.description}
                    onChange={(e) => setEditOffer({ ...editOffer, description: e.target.value })}
                    placeholder={t("c_offer_desc_ph")}
                    aria-label={t("c_aria_offer_desc")}
                    style={{ padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14 }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => void saveEditOffering()} style={{ padding: "6px 14px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
                      {t("c_save_btn")}
                    </button>
                    <button onClick={() => setEditOfferId(null)} style={{ padding: "6px 14px", background: "#fff", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
                      {t("c_cancel_btn")}
                    </button>
                  </div>
                </li>
              ) : (
                <li key={o.id} style={{ fontSize: 14, display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 200 }}>
                    <button
                      onClick={() => startEditOffering(o)}
                      style={{ background: "none", border: "none", padding: 0, color: "#15803d", fontWeight: 600, cursor: "pointer", textAlign: "left", font: "inherit" }}
                      title={t("c_click_to_edit")}
                    >
                      {o.title}
                    </button>
                    <span style={{ color: "#166534", fontSize: 12, marginLeft: 6 }}>
                      {o.kindLabel}
                      {o.maxDistance ? `${t("c_offer_dist_a")}${o.maxDistance}${t("c_offer_dist_b")}` : ""}
                      {o.published ? t("c_offer_published_tag") : ""}
                    </span>
                  </span>
                  <button
                    onClick={() => startEditOffering(o)}
                    style={{ background: "none", border: "1px solid #86efac", color: "#166534", borderRadius: 8, cursor: "pointer", fontSize: 12, padding: "3px 10px" }}
                  >
                    {t("c_edit_btn")}
                  </button>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#166534", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={o.published}
                      onChange={(e) => void toggleOfferingPublished(o.id, e.target.checked)}
                    />
                    {t("c_publish_toggle")}
                  </label>
                  <button
                    aria-label={`${o.title}${t("c_delete_suffix")}`}
                    onClick={() => void removeOffering(o.id)}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: 2 }}
                  >
                    ✕
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
        {marketUrl && offerings.some((o) => o.published) && (
          <p style={{ fontSize: 12, color: "#166534", margin: "0 0 10px" }}>
            {t("c_public_page_label")}{" "}
            <a href="/market" target="_blank" rel="noopener noreferrer" style={{ color: "#15803d" }}>
              {t("c_market_link")}
            </a>
            {t("c_market_share_hint")}
          </p>
        )}
        {offerInterests.length > 0 && (
          <div style={{ margin: "10px 0", border: "1px solid #86efac", background: "#dcfce7", borderRadius: 10, padding: "10px 12px" }}>
            <p style={{ fontSize: 13, color: "#166534", margin: "0 0 6px", fontWeight: 600 }}>
              {t("c_interests_a")}{offerInterests.length}{t("c_interests_b")}
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {offerInterests.map((it) => (
                <li key={it.id} style={{ fontSize: 14 }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>{it.guestName}</span>
                    <span style={{ color: "#166534", fontSize: 12, marginLeft: 6 }}>
                      {t("c_qo")}{it.offeringTitle}{t("c_qc")}{it.guestContact ? `${t("c_sep")}${it.guestContact}` : ""}
                    </span>
                  </div>
                  {it.message && <div style={{ color: "#334155", marginTop: 2 }}>{it.message}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button
                      onClick={() => void approveInterest(it.id)}
                      style={{ padding: "5px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                    >
                      {t("c_welcome_contact")}
                    </button>
                    <button
                      onClick={() => void dismissInterest(it.id)}
                      style={{ padding: "5px 12px", background: "#fff", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                    >
                      {t("c_skip_this_time")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {showOfferForm ? (
          <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
            <input
              value={offerTitle}
              onChange={(e) => setOfferTitle(e.target.value)}
              placeholder={t("c_offer_title_ph")}
              style={{ padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14 }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select
                aria-label={t("c_aria_offer_kind")}
                value={offerKind}
                onChange={(e) => setOfferKind(e.target.value)}
                style={{ padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14 }}
              >
                {offerKinds.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
              <select
                aria-label={t("c_aria_offer_range")}
                value={offerMaxDist}
                onChange={(e) => setOfferMaxDist(e.target.value)}
                style={{ padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14 }}
              >
                <option value="">{t("c_range_anyone")}</option>
                <option value="2">{t("c_range_2")}</option>
                <option value="3">{t("c_range_3")}</option>
                <option value="4">{t("c_range_4")}</option>
              </select>
            </div>
            <input
              value={offerDesc}
              onChange={(e) => setOfferDesc(e.target.value)}
              placeholder={t("c_offer_desc_ph2")}
              style={{ padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => void addOffering()}
                style={{ padding: "8px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
              >
                {t("c_register_btn")}
              </button>
              <button
                onClick={() => setShowOfferForm(false)}
                style={{ padding: "8px 16px", background: "#fff", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
              >
                {t("c_cancel_btn")}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <button
              onClick={() => setShowOfferForm(true)}
              style={{ padding: "6px 14px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
            >
              {t("c_write_offering")}
            </button>
            <button
              onClick={() => setShowOfferImport((v) => !v)}
              style={{ padding: "6px 14px", background: "#fff", color: "#166534", border: "1px solid #86efac", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
            >
              {t("c_bulk_import_offerings")}
            </button>
          </div>
        )}
        {showOfferImport && (
          <div style={{ display: "grid", gap: 8, margin: "0 0 10px", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 12px", background: "#fff" }}>
            <p style={{ fontSize: 13, color: "#166534", margin: 0 }}>
              {t("c_offer_import_desc")}
            </p>
            <textarea
              value={offerImportText}
              onChange={(e) => setOfferImportText(e.target.value)}
              aria-label={t("c_aria_offer_list")}
              placeholder={t("c_offer_import_ph")}
              rows={6}
              style={{ padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14, fontFamily: "inherit", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => void importOfferings()}
                style={{ padding: "8px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
              >
                {t("c_import_classify_btn")}
              </button>
              <button
                onClick={() => setShowOfferImport(false)}
                style={{ padding: "8px 16px", background: "#fff", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
              >
                {t("c_cancel_btn")}
              </button>
            </div>
          </div>
        )}
        {offerMatches.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <p style={{ fontSize: 13, color: "#166534", margin: "8px 0 6px", fontWeight: 600 }}>
              {t("c_matches_found")}
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
              {offerMatches.map((m) => (
                <li key={m.offeringId} style={{ fontSize: 14 }}>
                  <div style={{ color: "#15803d", fontWeight: 600, marginBottom: 4 }}>
                    {m.title}
                    <span style={{ color: "#166534", fontSize: 12, marginLeft: 6 }}>{m.kindLabel}</span>
                  </div>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                    {m.contacts.map((ct) => (
                      <li key={ct.contactId} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, paddingLeft: 8 }}>
                        <Link href={`/contacts/${ct.contactId}`} style={{ color: "#15803d", fontWeight: 600 }}>
                          {ct.name}
                        </Link>
                        <span style={{ color: "#166534", fontSize: 12, flex: 1, minWidth: 180 }}>{ct.reason}</span>
                        {offeredTo[`${m.offeringId}:${ct.contactId}`] ? (
                          <span style={{ color: "#047857", fontSize: 13 }}>{t("c_offer_noted")}</span>
                        ) : (
                          <button
                            onClick={() => void offerToContact(m.offeringId, ct.contactId, m.title, m.kindLabel)}
                            style={{ padding: "5px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                          >
                            {t("c_offer_to_this")}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Fold>

      <Fold k="cl12" defaultOpen={false} title={<>{t("c_intro_title")}</>} style={{ margin: "16px 0", border: "1px solid #ddd6fe", background: "#faf5ff", borderRadius: 12, padding: "12px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <button
            style={{ padding: "6px 14px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                const res = await apiFetch("relationship/introductions");
                const body = await res.json().catch(() => ({}));
                if (res.ok) {
                  setIntros(body.introductions ?? []);
                  setIntroNote(body.note ?? "");
                } else {
                  setError(body.detail ?? t("c_intro_failed"));
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t("c_thinking") : t("c_find_intros")}
          </button>
        </div>
        <p style={{ fontSize: 13, color: "#6b21a8", margin: "6px 0 0" }}>
          {t("c_intro_desc")}
        </p>
        {intros && intros.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 10 }}>
            {intros.map((it, i) => (
              <li key={i} style={{ background: "#fff", border: "1px solid #e9d5ff", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontWeight: 700, color: "#5b21b6" }}>{it.personA}{t("c_and_sep")}{it.personB}</div>
                {it.reason && <div style={{ fontSize: 14, marginTop: 3, lineHeight: 1.8 }}>{it.reason}</div>}
                {it.how && <div style={{ fontSize: 13, color: "#475569", marginTop: 3 }}>{t("c_intro_how_label")}{it.how}</div>}
                {it.caution && <div style={{ fontSize: 13, color: "#92400e", marginTop: 3 }}>{it.caution}</div>}
              </li>
            ))}
          </ul>
        )}
        {intros && intros.length === 0 && (
          <p style={{ fontSize: 13, color: "#6b7280", margin: "8px 0 0" }}>
            {introNote || t("c_intro_none")}
          </p>
        )}
      </Fold>

      {importMsg && (
        <p aria-live="polite" style={{ color: "#1e40af", background: "#eff6ff", padding: 8, borderRadius: 8 }}>
          {importMsg}
        </p>
      )}
      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>
          {error}
        </p>
      )}

      {jobs.length > 0 &&
        (() => {
          const active = jobs.filter((j) => j.status === "queued" || j.status === "processing").length;
          const label = (s: string) =>
            s === "queued" ? t("c_job_queued") : s === "processing" ? t("c_job_processing") : s === "done" ? t("c_job_done") : t("c_job_error");
          const color = (s: string) =>
            s === "done" ? "#166534" : s === "error" ? "#b91c1c" : "#1e40af";
          return (
            <Fold k="cl13" defaultOpen={false} title={<>{t("c_jobs_title")}</>}
              style={{ margin: "16px 0", border: "1px solid #bfdbfe", background: "#eff6ff", borderRadius: 12, padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                {active === 0 && (
                  <button
                    onClick={() => void clearJobs()}
                    style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13 }}
                  >
                    {t("c_clear_jobs")}
                  </button>
                )}
              </div>
              <p style={{ color: "#475569", fontSize: 13, margin: "4px 0 10px" }}>
                {active > 0
                  ? t("c_jobs_active_desc")
                  : t("c_jobs_done_desc")}
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                {jobs.slice(0, 30).map((j) => (
                  <li key={j.id} style={{ fontSize: 14, display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {j.filename || (j.kind === "text" ? t("c_pasted_content") : t("c_file_word"))}
                    </span>
                    <span style={{ color: color(j.status), whiteSpace: "nowrap" }}>
                      {label(j.status)}
                      {j.status === "done" &&
                        (j.imported > 0 || j.enriched > 0
                          ? `${t("c_po")}${j.imported > 0 ? `${j.imported}${t("c_added_suffix")}` : ""}${j.imported > 0 && j.enriched > 0 ? t("c_sep") : ""}${j.enriched > 0 ? `${j.enriched}${t("c_enriched_suffix")}` : ""}${t("c_pc")}`
                          : t("c_no_new_people"))}
                    </span>
                  </li>
                ))}
              </ul>
            </Fold>
          );
        })()}

      {dupeGroups.length > 0 && (
        <Fold k="cl14" defaultOpen={false} title={<>{t("c_dupes_title")}</>} style={{ margin: "16px 0", border: "1px solid #bfdbfe", background: "#eff6ff", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ color: "#475569", fontSize: 13, margin: "0 0 10px" }}>
            {t("c_dupes_desc")}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {dupeGroups.slice(0, 20).map((g) => (
              <li key={g.key} style={{ border: "1px solid #dbeafe", borderRadius: 10, padding: "10px 12px", background: "#fff" }}>
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 4 }}>
                  {g.reason}
                  {!g.strong && t("c_dupe_weak_note")}
                </div>
                <div style={{ fontSize: 14 }}>
                  {g.members.map((m) => (
                    <span key={m.id} style={{ marginRight: 12 }}>
                      <Link href={`/contacts/${m.id}`} style={{ color: "#1d4ed8", fontWeight: 600, textDecoration: "none" }}>
                        {m.name}
                      </Link>
                      {m.company && <span style={{ color: "#94a3b8" }}> ({m.company})</span>}
                    </span>
                  ))}
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => void mergeGroup(g)}
                    style={{ padding: "6px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                  >
                    {t("c_merge_btn")}
                  </button>
                  <button
                    onClick={() => void markDifferentPeople(g)}
                    style={{ padding: "6px 14px", background: "#fff", color: "#475569", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                  >
                    {t("c_mark_different_btn")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      <Fold k="cl15" defaultOpen={false} title={<>{t("add_section")}</>} style={{ margin: "24px 0" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder={t("name_placeholder")}
            aria-label={t("c_name_label")}
            style={{ flex: 1, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8 }}
          />
          <select
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            aria-label={t("c_distance_label")}
            style={{ padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8 }}
          >
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>{t(DISTANCE_LABEL[d] ?? "")}</option>
            ))}
          </select>
          <button
            onClick={() => void add()}
            disabled={busy || !name.trim()}
            style={{ padding: "10px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
          >
            {t("add_button")}
          </button>
        </div>
        {duplicates && (
          <section
            aria-label={t("c_aria_same_name")}
            style={{
              border: "1px solid #bfdbfe",
              background: "#eff6ff",
              borderRadius: 12,
              padding: 16,
              marginTop: 12,
            }}
          >
            <p style={{ margin: "0 0 10px", fontWeight: 600 }}>
              {t("c_qo")}{pendingName}{t("c_qc")}{t("c_dup_exists")}
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {duplicates.map((d) => (
                <Link
                  key={d.id}
                  href={`/contacts/${d.id}`}
                  style={{
                    display: "block",
                    padding: "10px 14px",
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{d.name}</span>
                  <span style={{ display: "block", color: "#64748b", fontSize: 14 }}>
                    {[d.company, d.title].filter(Boolean).join(" ") || t("c_no_affiliation")}
                    {t("c_sep_spaced")}
                    {t(DISTANCE_LABEL[d.distance] ?? "")}
                    {t("c_dup_open_hint")}
                  </span>
                </Link>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <button
                onClick={() => void add(true)}
                disabled={busy}
                style={{
                  padding: "8px 14px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                {t("c_add_as_new")}
              </button>
              <button
                onClick={() => {
                  setDuplicates(null);
                  setPendingName("");
                }}
                disabled={busy}
                style={{ padding: "8px 14px", background: "none", border: "none", color: "#64748b", cursor: "pointer" }}
              >
                {t("c_cancel_btn")}
              </button>
            </div>
          </section>
        )}
        <p style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowImport(!showImport)}
            style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}
          >
            {showImport ? t("c_close_import") : t("c_open_import")}
          </button>
        </p>
        {showImport && (
          <div>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void collectDropped(e.dataTransfer).then((files) => {
                  if (files.length > 0) void uploadFiles(files);
                });
              }}
              style={{
                display: "block",
                border: `2px dashed ${dragOver ? "#2563eb" : "#cbd5e1"}`,
                background: dragOver ? "#eff6ff" : "#f8fafc",
                borderRadius: 12,
                padding: "24px 16px",
                textAlign: "center",
                color: "#334155",
                cursor: "pointer",
                marginBottom: 8,
              }}
            >
              {t("c_dropzone_main")}
              <br />
              <small style={{ color: "#64748b" }}>
                {t("c_dropzone_sub")}
              </small>
              <input
                type="file"
                multiple
                aria-label={t("c_aria_import_file")}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) void uploadFiles(e.target.files);
                  e.target.value = "";
                }}
                style={{ display: "none" }}
              />
            </label>
            <p style={{ margin: "0 0 8px", textAlign: "center", display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
              <label style={{ color: "#2563eb", cursor: "pointer", fontSize: 14 }}>
                {t("c_capture_import")}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  aria-label={t("c_aria_capture")}
                  {...({ capture: "environment" } as Record<string, string>)}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) void uploadFiles(e.target.files);
                    e.target.value = "";
                  }}
                  style={{ display: "none" }}
                />
              </label>
              <label style={{ color: "#2563eb", cursor: "pointer", fontSize: 14 }}>
                {t("c_folder_import")}
                <input
                  type="file"
                  multiple
                  aria-label={t("c_aria_import_folder")}
                  {...({ webkitdirectory: "" } as Record<string, string>)}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) void uploadFiles(e.target.files);
                    e.target.value = "";
                  }}
                  style={{ display: "none" }}
                />
              </label>
            </p>
            <details style={{ margin: "8px 0", color: "#334155" }}>
              <summary style={{ cursor: "pointer", color: "#2563eb" }}>{t("c_howto_title")}</summary>
              <div style={{ padding: "8px 4px", display: "grid", gap: 10, fontSize: 14 }}>
                <div>
                  <strong>{t("c_howto_photos_t")}</strong>{t("c_howto_photos_b")}
                </div>
                <div>
                  <strong>LINE</strong>{t("c_howto_line_b")}
                </div>
                <div>
                  <strong>LinkedIn</strong> —{" "}
                  <a href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                    {t("c_howto_dl_link")}
                  </a>
                  {t("c_howto_linkedin_b")}
                </div>
                <div>
                  <strong>Facebook / Instagram</strong> —{" "}
                  <a href="https://accountscenter.facebook.com/info_and_permissions/dyi" target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                    {t("c_howto_fb_link")}
                  </a>
                  {t("c_howto_fb_b")}
                </div>
                <div>
                  <strong>X</strong> —{" "}
                  <a href="https://x.com/settings/download_your_data" target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                    {t("c_howto_x_link")}
                  </a>
                  {t("c_howto_x_b")}
                </div>
                <div>
                  <strong>{t("c_howto_google_t")}</strong> —{" "}
                  <a href="https://contacts.google.com" target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                    contacts.google.com
                  </a>
                  {t("c_howto_google_b")}
                </div>
                <div>
                  <strong>{t("c_howto_eight_t")}</strong>{t("c_howto_eight_b")}
                </div>
                <div>
                  <strong>{t("c_howto_other_t")}</strong>{t("c_howto_other_b")}
                </div>
              </div>
            </details>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={t("c_paste_import_ph")}
              aria-label={t("c_aria_import_content")}
              rows={6}
              style={{ width: "100%", padding: 10, border: "1px solid #e2e8f0", borderRadius: 8 }}
            />
            <button
              onClick={() => void runImport()}
              disabled={busy || !importText.trim()}
              style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
            >
              {t("c_import_btn")}
            </button>
          </div>
        )}
        <p style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowConv(!showConv)}
            style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}
          >
            {showConv ? t("c_close_conv") : t("c_open_conv")}
          </button>
        </p>
        {showConv && (
          <div>
            <p style={{ margin: "4px 0", color: "#64748b", fontSize: 14 }}>
              {t("c_conv_desc")}
            </p>
            <textarea
              value={convText}
              onChange={(e) => setConvText(e.target.value)}
              placeholder={t("c_conv_ph")}
              aria-label={t("c_aria_conv")}
              rows={5}
              style={{ width: "100%", padding: 10, border: "1px solid #e2e8f0", borderRadius: 8 }}
            />
            <button
              onClick={() => void extractFromConversation()}
              disabled={busy || !convText.trim()}
              style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
            >
              {t("c_conv_search_btn")}
            </button>
            {proposals.length > 0 && (
              <div style={{ marginTop: 10, border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 14px" }}>
                <p style={{ margin: "0 0 8px", color: "#334155" }}>{t("c_conv_found")}</p>
                <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
                  {proposals.map((p, i) => (
                    <li key={`${p.name}-${i}`} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <input
                        type="checkbox"
                        checked={p.selected}
                        aria-label={`${p.name}${t("c_aria_apply_suffix")}`}
                        onChange={(e) =>
                          setProposals((prev) => prev.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))
                        }
                        style={{ marginTop: 4 }}
                      />
                      <span>
                        <strong>{p.name}</strong>
                        {p.contactId ? (
                          <small style={{ color: "#64748b", marginLeft: 6 }}>{t("c_conv_existing")}</small>
                        ) : (
                          <small style={{ color: "#0891b2", marginLeft: 6 }}>{t("c_conv_new")}</small>
                        )}
                        {p.date && <small style={{ color: "#64748b", marginLeft: 6 }}>{p.date}{t("c_conv_met_suffix")}</small>}
                        {p.note && <span style={{ display: "block", color: "#334155", fontSize: 14 }}>{p.note}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => void applyProposals()}
                  disabled={busy || proposals.every((p) => !p.selected)}
                  style={{ marginTop: 8, padding: "8px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
                >
                  {t("c_apply_selected")}
                </button>
              </div>
            )}
          </div>
        )}
      </Fold>

      <section style={{ margin: "24px 0" }}>
        <p>
          <button
            onClick={() => setShowCalendar(!showCalendar)}
            style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}
          >
            {showCalendar ? t("c_close_cal") : t("c_open_cal")}
          </button>
        </p>
        {showCalendar && (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={icsUrl}
              onChange={(e) => setIcsUrl(e.target.value)}
              placeholder={t("c_ics_ph")}
              aria-label={t("c_aria_ics")}
              style={{ flex: 1, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8 }}
            />
            <button
              onClick={async () => {
                const res = await apiFetch("relationship/my-busy", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ icsUrl }),
                });
                const body = await res.json().catch(() => ({}));
                if (res.ok) {
                  setNotice(`${t("c_cal_connected_a")}${body.saved}${t("c_cal_connected_b")}`);
                  setIcsUrl("");
                  setShowCalendar(false);
                } else {
                  setError(body.detail ?? t("c_cal_connect_failed"));
                }
              }}
              disabled={busy || !icsUrl.trim()}
              style={{ padding: "10px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
            >
              {t("c_connect_btn")}
            </button>
            <button
              onClick={async () => {
                const res = await apiFetch("relationship/refresh-calendars", { method: "POST", body: "{}" });
                const body = await res.json().catch(() => ({}));
                if (res.ok) setNotice(`${t("c_cal_refreshed_a")}${body.refreshed}${t("c_cal_refreshed_b")}`);
              }}
              style={{ padding: "10px 12px", border: "1px solid #2563eb", color: "#2563eb", background: "#fff", borderRadius: 8, cursor: "pointer" }}
            >
              {t("c_refresh_btn")}
            </button>
          </div>
        )}
        {showCalendar && (
          <p style={{ color: "#94a3b8", fontSize: 12, margin: "8px 0 0", lineHeight: 1.7 }}>
            {t("c_cal_hint")}
          </p>
        )}
      </section>

      <Fold k="cl27" defaultOpen={false} title={<>{t("c_newcomer_title")}</>} style={{ margin: "24px 0", border: "1px solid #fbcfe8", background: "#fdf2f8", borderRadius: 12, padding: "14px 16px" }}>
        <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 10px", lineHeight: 1.7 }}>
          {t("c_newcomer_desc")}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder={t("c_event_name_ph")}
            style={{ flex: "2 1 220px", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8 }}
          />
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            aria-label={t("c_aria_event_date")}
            style={{ flex: "1 1 140px", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8 }}
          />
        </div>
        <textarea
          value={newcomerText}
          onChange={(e) => setNewcomerText(e.target.value)}
          rows={5}
          placeholder={t("c_newcomer_ph")}
          style={{ width: "100%", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <button
            onClick={runNewcomers}
            disabled={busy || !newcomerText.trim()}
            style={{ padding: "10px 16px", background: "#db2777", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
          >
            {t("c_newcomer_btn")}
          </button>
          <label style={{ padding: "10px 16px", border: "1px solid #db2777", color: "#db2777", background: "#fff", borderRadius: 8, cursor: "pointer" }}>
            {t("c_newcomer_capture")}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) void uploadFiles(e.target.files, newcomerQuery());
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {newcomerResult && <p style={{ color: "#166534", marginTop: 8 }}>{newcomerResult}</p>}
        <p style={{ color: "#94a3b8", fontSize: 12, margin: "8px 0 0", lineHeight: 1.7 }}>
          {t("c_newcomer_footer")}
        </p>
      </Fold>

      <Fold k="cl18" defaultOpen={false} title={<>{t("c_sns_panel_title")}</>} style={{ margin: "24px 0", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        <p style={{ color: "#64748b", margin: "4px 0 10px", fontSize: 14 }}>
          {t("c_sns_panel_desc")}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SNS_CONNECTORS.map((s) => (
            <button
              key={s.key}
              onClick={() => {
                window.open(s.url, "_blank", "noopener,noreferrer");
                setConnectHint(t(s.hintKey));
                setShowImport(true);
              }}
              style={{
                padding: "8px 16px",
                background: "#fff",
                color: "#2563eb",
                border: "1px solid #2563eb",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              {t(s.label)}{t("c_connect_suffix")}
            </button>
          ))}
        </div>
        {connectHint && (
          <p aria-live="polite" style={{ margin: "10px 0 0", color: "#1e40af", background: "#eff6ff", padding: 10, borderRadius: 8, fontSize: 14 }}>
            {connectHint}
          </p>
        )}
      </Fold>

      <Fold k="cl19" defaultOpen={false} title={<>{t("c_google_title")}</>} style={{ margin: "24px 0", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        <p style={{ color: "#64748b", margin: "4px 0 10px", fontSize: 14 }}>
          {t("c_google_desc")}
        </p>
        {googleStatus === null && <p style={{ color: "#64748b" }}>{t("c_checking")}</p>}
        {googleStatus?.available === false && (
          <p style={{ color: "#64748b" }}>{t("c_google_unavailable")}</p>
        )}
        {googleStatus?.available && !googleStatus.connected && (
          <button
            onClick={async () => {
              const res = await apiFetch("google/auth-url");
              const body = await res.json().catch(() => ({}));
              if (res.ok && body.url) window.location.href = body.url;
              else setError(body.detail ?? t("c_connect_failed_now"));
            }}
            disabled={busy}
            style={{ padding: "10px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
          >
            {t("c_google_connect_btn")}
          </button>
        )}
        {googleStatus?.available && googleStatus.connected && (
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#166534" }}>
              {t("c_google_connected")}{googleStatus.email ? ` (${googleStatus.email})` : ""}
            </span>
            {googleStatus.lastSyncNote && (
              <small style={{ color: "#64748b" }}>{t("c_last_time")}{googleStatus.lastSyncNote}</small>
            )}
            <button
              onClick={() => void syncGoogle()}
              disabled={busy}
              style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
            >
              {t("c_sync_now_btn")}
            </button>
          </div>
        )}
        {googleStatus?.available && googleStatus.connected && !googleStatus.extended && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #e2e8f0" }}>
            <p style={{ color: "#64748b", margin: "0 0 8px", fontSize: 13, lineHeight: 1.8 }}>
              {t("c_google_ext_desc")}
            </p>
            <button
              onClick={async () => {
                const res = await apiFetch("google/auth-url?scope=extended");
                const body = await res.json().catch(() => ({}));
                if (res.ok && body.url) window.location.href = body.url;
                else setError(body.detail ?? t("c_connect_failed_now"));
              }}
              disabled={busy}
              style={{ padding: "8px 16px", background: "#fff", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer" }}
            >
              {t("c_google_ext_btn")}
            </button>
          </div>
        )}
      </Fold>

      <Fold k="cl25" defaultOpen={false} title={<>{t("c_axis_title")}</>} style={{ margin: "16px 0", border: "1px solid #cbd5e1", background: "#f8fafc", borderRadius: 12, padding: "12px 16px" }}>
        <p style={{ fontSize: 13, color: "#475569", margin: "4px 0 10px" }}>
          {t("c_axis_desc")}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {[
            { key: "influence", label: t("c_axis_influence") },
            { key: "expertise", label: t("c_axis_expertise") },
            { key: "values", label: t("c_axis_values") },
            { key: "integrity", label: t("c_axis_integrity") },
          ].map((a) => (
            <button
              key={a.key}
              onClick={() => void runAxisSearch(a.key)}
              style={{
                padding: "7px 14px",
                borderRadius: 999,
                border: axis === a.key ? "1px solid #2563eb" : "1px solid #cbd5e1",
                background: axis === a.key ? "#2563eb" : "#fff",
                color: axis === a.key ? "#fff" : "#334155",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
        {axis && axisBusy && <p style={{ color: "#64748b", fontSize: 13 }}>{t("c_searching")}</p>}
        {axis && !axisBusy && axisItems.length === 0 && (
          <p style={{ color: "#64748b", fontSize: 13 }}>
            {t("c_axis_empty")}
          </p>
        )}
        {axis && axisItems.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {axisItems.map((it) => (
              <li key={it.contactId} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 12px", background: "#fff", fontSize: 14 }}>
                <Link href={`/contacts/${it.contactId}`} style={{ color: "#1d4ed8", fontWeight: 600, textDecoration: "none" }}>
                  {it.name}
                </Link>
                {(it.company || it.title) && (
                  <span style={{ color: "#94a3b8", fontSize: 12, marginLeft: 8 }}>{[it.company, it.title].filter(Boolean).join(" ")}</span>
                )}
                {it.reasons.length > 0 && (
                  <span style={{ display: "block", color: "#64748b", fontSize: 12, marginTop: 2 }}>{it.reasons.join(t("c_sep"))}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Fold>

      <Fold k="cl20" defaultOpen={false} title={<>{t("everyone")} ({totalContacts ?? contacts.length})</>}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {contacts.length > 30 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              style={{ padding: "8px 14px", background: "transparent", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
            >
              {showAll ? t("c_collapse_list") : `${t("c_show_all_a")}${contacts.length}${t("c_show_all_b")}`}
            </button>
          )}
        </div>
        {contacts.length > 30 && !showAll && (
          <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 8px" }}>
            人数が多いため一覧は畳んでいます。お探しの方は、ページ一番上の検索窓からどうぞ。全員の記録はそのまま残っています。
          </p>
        )}
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {(contacts.length > 30 && !showAll ? [] : contacts).map((c) => (
            <li key={c.id} style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
              <Link
                href={`/contacts/${c.id}`}
                style={{
                  flex: 1,
                  display: "flex",
                  justifyContent: "space-between",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "10px 14px",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span>
                  {c.name}
                  {c.company && <small style={{ color: "#64748b", marginLeft: 8 }}>{c.company}</small>}
                </span>
                <small style={{ color: "#64748b" }}>{t(DISTANCE_LABEL[c.distance] ?? "")}</small>
              </Link>
              {c.email && (
                <a
                  href={`mailto:${c.email}`}
                  aria-label={`${c.name}${t("c_aria_mail_suffix")}`}
                  title={t("c_mail_title")}
                  style={{ display: "flex", alignItems: "center", padding: "0 12px", border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 10, textDecoration: "none", fontSize: 13, whiteSpace: "nowrap" }}
                >
                  ✉ {t("c_mail_word")}
                </a>
              )}
            </li>
          ))}
          {contacts.length === 0 && <li style={{ color: "#64748b" }}>{t("c_list_empty")}</li>}
        </ul>
      </Fold>
    </main>
  );
}
