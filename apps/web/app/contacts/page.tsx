"use client";
// 連絡帳 + つながりスコア + 「今日、連絡してみませんか」(lms の関係性ダッシュボードを移植)。
// 文言は寄り添い基調・技術語なし・記号装飾なし (CLAUDE.md 共通プロダクト原則)。
import { useCallback, useEffect, useRef, useState } from "react";
import Fold from "../../components/Fold";
import { apiFetch } from "../../lib/client-api";
import { AuthBar } from "../../components/AuthBar";
import { LanguageSelector } from "../../components/LanguageSelector";
import { t } from "../../lib/i18n";
import Link from "next/link";

type Contact = {
  id: string;
  name: string;
  furigana: string | null;
  distance: number;
  relationship: string;
  company: string | null;
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
const SNS_CONNECTORS: { key: string; label: string; url: string; hint: string }[] = [
  {
    key: "line",
    label: "LINE",
    url: "https://guide.line.me/ja/services/chat-history.html",
    hint: "LINE のトーク画面 → 右上メニュー → 設定 → トーク履歴を送信、で作られるテキストファイルを、下の取り込みに置いてください。お相手とやりとりの記録が一度に入ります。",
  },
  {
    key: "x",
    label: "X (旧Twitter)",
    url: "https://x.com/settings/download_your_data",
    hint: "X の「データのアーカイブをダウンロード」で受け取った ZIP を、下の取り込みにそのまま置いてください。",
  },
  {
    key: "instagram",
    label: "Instagram",
    url: "https://accountscenter.facebook.com/info_and_permissions/dyi",
    hint: "アカウントセンターの「情報をダウンロード」で、対象をフォロー中の人・形式は JSON にすると軽くなります。届いた ZIP を下の取り込みに置いてください。",
  },
  {
    key: "facebook",
    label: "Facebook",
    url: "https://accountscenter.facebook.com/info_and_permissions/dyi",
    hint: "アカウントセンターの「情報をダウンロード」で友達を選び、届いた ZIP を下の取り込みに置いてください。",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    url: "https://www.linkedin.com/mypreferences/d/download-my-data",
    hint: "LinkedIn の「データのダウンロード」で Connections を選び、届いた ZIP か CSV を下の取り込みに置いてください。",
  },
  {
    key: "outlook",
    label: "Outlook",
    url: "https://support.microsoft.com/ja-jp/office/outlook-から連絡先をエクスポートする-10f09abd-643c-4495-bb80-543714eca73f",
    hint: "Outlook の連絡先を CSV で書き出して (People 画面 → 管理 → 連絡先のエクスポート)、届いた CSV を下の取り込みに置いてください。お名前・メール・電話・会社・役職ごと入ります。予定表は下の「ご自身の予定表とつなぐ」に Outlook の公開 ICS アドレスを貼ると面談候補にも使えます。",
  },
];

const LEVEL_LABEL: Record<string, { label: string; color: string; message: string }> = {
  good: { label: "良好", color: "#27ae60", message: "大切な方とのつながりがしっかり保たれています。" },
  fair: { label: "まずまず", color: "#f1c40f", message: "概ね良いですが、少し間が空いている方がいます。" },
  caution: { label: "少し注意", color: "#e67e22", message: "しばらくご連絡していない方がいらっしゃいます。" },
  warning: { label: "要注意", color: "#e74c3c", message: "大切な方との連絡が途絶えがちです。ぜひお声がけを。" },
  unknown: { label: "これから", color: "#8896a6", message: "連絡先を登録すると、つながりの状態を確認できます。" },
};

const DISTANCE_LABEL: Record<number, string> = {
  1: "毎日会いたい",
  2: "週に一度は",
  3: "月に一度は",
  4: "折々に",
  5: "年に一度は",
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [name, setName] = useState("");
  const [distance, setDistance] = useState("3");
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);
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
    email?: string | null;
    lastSyncNote?: string | null;
  } | null>(null);
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
  type DupeGroup = { reason: string; strong: boolean; members: DupeMember[] };
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
  }, []);

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
      setNotice("申し出を登録しました。力になれそうな方をお探しします");
      await load();
    } else {
      setError("いまは登録できませんでした。時間をおいてお試しください");
    }
  };
  const removeOffering = async (id: string) => {
    const res = await apiFetch(`offerings/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  };
  const toggleOfferingPublished = async (id: string, published: boolean) => {
    const res = await apiFetch(`offerings/${id}`, { method: "PUT", body: JSON.stringify({ published }) });
    if (res.ok) {
      setNotice(published ? "掲示板に載せました。困っている方の目に留まります" : "掲示板から下ろしました");
      await load();
    }
  };
  const approveInterest = async (id: string) => {
    const res = await apiFetch(`relationship/offering-interests/${id}/approve`, { method: "POST", body: "{}" });
    if (res.ok) {
      setNotice("連絡先に迎えました。ここから関係を育てていけます");
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
      setNotice("台帳に「申し出」として控えました。実際の連絡は連絡先の画面からどうぞ");
    } else {
      setError("いまは控えられませんでした。時間をおいてお試しください");
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
      setNotice("距離感を直しました");
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
      setNotice(purpose ? "関係の目標を決めました" : "目標を外しました");
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
          ? "このリストから外しました。記録はそのまま残り、いつでも戻せます"
          : preference === "pinned"
            ? "大切な方として印を付けました"
            : "自動判定に戻しました",
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
  const mergeGroup = async (g: DupeGroup) => {
    if (busy || g.members.length < 2) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId: g.members[0]!.id, otherIds: g.members.slice(1).map((m) => m.id) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail ?? "まとめられませんでした");
        return;
      }
      setNotice(`${g.members.length}件を1件にまとめました`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  // Google 連携のお相手取り込み (「いま取り込む」と、つないだ直後の自動取り込みで共用)。
  const syncGoogle = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    setError("");
    setNotice("お相手を取り込んでいます… (少し時間がかかります)");
    try {
      const res = await apiFetch("google/sync", { method: "POST", body: "{}" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice("");
        setError(body.detail ?? "いまは取り込めませんでした");
        return;
      }
      const dup =
        Array.isArray(body.sameName) && body.sameName.length > 0
          ? `。同じお名前で見送った方: ${body.sameName.slice(0, 5).join("、")}`
          : "";
      setNotice(`Google から連絡先${body.imported ?? 0}件、やりとりの記録${body.interactionsAdded ?? 0}件を取り込みました${dup}`);
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
      if (g === "error") setError("Google との接続がうまくいきませんでした。もう一度お試しください");
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
        setNotice(`${n}件を受け付けました。このあとサーバで読み取りが進みます。ページを離れても大丈夫です`);
        void (async () => {
          await loadJobs();
          void pumpJobs();
        })();
      } else {
        setError("共有されたファイルを取り込めませんでした。ファイルを選んで取り込む方法もお試しください");
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
        setError((await res.json().catch(() => ({}))).detail ?? "追加できませんでした");
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
        setError(`取り込めませんでした (エラー ${res.status})${detail ? `: ${detail}` : ""}`);
        return;
      }
      setImportText("");
      setShowImport(false);
      setNotice("取り込みを受け付けました。このあとサーバで読み取りが進みます。ページを離れても大丈夫です");
      await loadJobs();
      void pumpJobs();
    } catch (e) {
      setError(`取り込み中にエラーが起きました: ${e instanceof Error ? e.message : String(e)}`);
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

  const uploadFiles = async (files: FileList | File[]) => {
    if (busy) return;
    const list = Array.from(files)
      .filter((f) => f.size > 0 && !MEDIA_SKIP.test(f.name))
      .slice(0, MAX_UPLOAD_FILES);
    if (list.length === 0) {
      setError("読み取れるファイルが見つかりませんでした (写真や動画はまだ取り込めません)");
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
        setImportMsg(`受け付けています (${i + 1}/${list.length}件目): ${path}`);
        try {
          const res = await apiFetch(`contacts/import-jobs?filename=${encodeURIComponent(path)}`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: await file.arrayBuffer(),
          });
          if (res.ok) queued++;
          else {
            const b = await res.json().catch(() => ({}) as Record<string, unknown>);
            problems.push(`${path}: エラー ${res.status}${b.detail ? ` ${b.detail}` : ""}`);
          }
        } catch (e) {
          problems.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (queued > 0) {
        setNotice(
          `${queued}件を受け付けました。このあとサーバで読み取りが進みます。ページを離れたり、ほかのことをしていても大丈夫です`,
        );
      }
      if (problems.length > 0) {
        setError(problems.slice(0, 5).join(" / ") + (problems.length > 5 ? ` ほか${problems.length - 5}件` : ""));
      } else if (queued === 0) {
        setError("取り込めませんでした。もう一度お試しください");
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
    setImportMsg("会話の内容からお相手をさがしています…");
    try {
      const res = await apiFetch("contacts/extract-from-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: convText }),
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
        setError(`いまは読み取れませんでした (エラー ${res.status})${detail ? `: ${detail}` : ""}`);
        return;
      }
      const list = (body.proposals ?? []) as { name: string; note: string; date: string | null; contactId: string | null }[];
      if (list.length === 0) {
        setNotice("この内容からはお相手を見つけられませんでした");
        return;
      }
      setProposals(list.map((p) => ({ ...p, selected: true })));
    } catch (e) {
      setError(`読み取り中にエラーが起きました: ${e instanceof Error ? e.message : String(e)}`);
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
      setNotice(`${applied}名ぶんを記録に反映しました`);
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
    setNotice("連絡の記録をつけました");
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
  const todayKey = new Date().toISOString().slice(0, 10);
  const dailyQDismissed = dailyQ ? isDismissed("daily_question", `${dailyQ.contactId}:${todayKey}`) : false;

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <LanguageSelector />
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <Link href="/settings" style={{ color: "#64748b", fontSize: 14 }}>設定</Link>
          <AuthBar />
        </div>
      </div>
      <p style={{ display: "flex", gap: 16 }}>
        <Link href="/" style={{ color: "#2563eb" }}>{t("back_home")}</Link>
        <Link href="/schedule" style={{ color: "#2563eb" }}>日程調整と時間の受け付け</Link>
      </p>
      <h1 style={{ fontSize: 24 }}>{t("contacts_title")}</h1>

      {summary && (
        <Fold k="cl0" title={<>{t("connection_score")}</>} style={{
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
          <p style={{ margin: "4px 0", color: level.color }}>{level.label}</p>
          <p style={{ margin: 0, color: "#334155" }}>{level.message}</p>
        </Fold>
      )}

      {progress && progress.totalInteractions > 0 && (
        <Fold k="cl1" title={<>これまでの歩み</>} style={{ background: "#f8fafc", borderRadius: 12, padding: "12px 16px", margin: "16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ color: "#334155" }}>
              {progress.streakDays > 0 ? `${progress.streakDays}日続いています` : ""}
            </span>
          </div>
          <p style={{ margin: "6px 0", color: "#64748b" }}>
            {progress.badges.filter((b) => b.achieved).map((b) => b.label).join(" / ") || "最初のひとつを目指しましょう"}
          </p>
          {progress.nextMilestone && (
            <div>
              <p style={{ margin: "4px 0", color: "#334155", fontSize: 14 }}>
                次の節目: {progress.nextMilestone.label} まであと {progress.nextMilestone.target - progress.nextMilestone.current}
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
        <Fold k="cl2" title={<>{t("today_suggestion")}</>} style={{ margin: "16px 0" }}>
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
                  <strong>{sug.name}</strong>さん
                  <span style={{ color: "#64748b", marginLeft: 8 }}>{sug.reason}</span>
                </span>
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
              </li>
            ))}
          </ul>
        </Fold>
      )}
      {summary && summary.today.length === 0 && contacts.length > 0 && (
        <p style={{ color: "#27ae60" }}>すべての方と適切な頻度でつながれています。素晴らしいですね。</p>
      )}

      {shownOccasions.length > 0 && (
        <Fold k="cl3" title={<>いま贈るとよい方・行事</>} style={{ margin: "16px 0", border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 12, padding: "12px 16px" }}>
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
                {dismissX(`${o.label} を見送る`, () => dismissSuggestion("gift_occasion", giftKey(o)))}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {shownExReminders.length > 0 && (
        <Fold k="cl4" title={<>そろそろ区切りをつけたいこと</>} style={{ margin: "16px 0", border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 12, padding: "12px 16px" }}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {shownExReminders.slice(0, 8).map((r) => (
              <li key={r.id} style={{ fontSize: 14, display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ flex: 1 }}>
                  <Link href={`/contacts/${r.contactId}`} style={{ color: r.overdue ? "#b91c1c" : "#b45309", fontWeight: 600 }}>
                    {r.contactName ?? "この方"}: {r.title}
                  </Link>
                  <span style={{ color: "#78716c" }}> — {r.note}</span>
                </span>
                {dismissX(`${r.title} の知らせを見送る`, () => dismissSuggestion("exchange_reminder", r.id))}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {shownDistanceSug.length > 0 && (
        <Fold k="cl5" title={<>距離感の見直し</>} style={{ margin: "16px 0", border: "1px solid #bae6fd", background: "#f0f9ff", borderRadius: 12, padding: "12px 16px" }}>
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
                  if (res.ok) setNotice(`${body.applied ?? 0}人の距離感を見直しました`);
                  await load();
                } finally {
                  setBusy(false);
                }
              }}
            >
              すべて反映
            </button>
          </div>
          <p style={{ fontSize: 13, color: "#475569", margin: "6px 0" }}>
            やりとりの多さや新しさから、いまの距離感（1が最も近く、5がたまに）を見直せます。反映するかはあなたが選べます。
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {shownDistanceSug.slice(0, 12).map((s) => (
              <li key={s.contactId} style={{ fontSize: 14, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <Link href={`/contacts/${s.contactId}`} style={{ color: "#0369a1", fontWeight: 600 }}>
                  {s.name}
                </Link>
                <span style={{ color: "#334155" }}>
                  {s.current} から {s.suggested} へ
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
                      setNotice(`${s.name}さんの距離感を ${s.suggested} にしました`);
                      await load();
                    }
                  }}
                >
                  この通りにする
                </button>
                {dismissX(`${s.name}さんの距離感の提案を見送る`, () => dismissSuggestion("distance", `${s.contactId}:${s.suggested}`))}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {shownDrift.length > 0 && (
        <Fold k="cl6" title={<>そっと気にかけたい関係</>} style={{ margin: "16px 0", border: "1px solid #fed7aa", background: "#fff7ed", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#9a3412", margin: "4px 0 8px" }}>
            近しかった方や、いつもやりとりされていた方との間が、少し空いてきています。よろしければ、久しぶりのひとことから。
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
                {dismissX(`${d.name}さんの気にかけを見送る`, () => dismissSuggestion("drift", d.contactId))}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {focusItems.length > 0 && (
        <Fold k="cl7" title={<>大切にしたい方々 (優先リスト)</>} style={{ margin: "16px 0", border: "2px solid #fbbf24", background: "#fffbeb", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#92400e", margin: "4px 0 8px" }}>
            くり返しの登場・記録の厚み・直近のやりとりから、いま関係を高める価値がありそうな方です。
            距離感や目標をここで直すと、以降のご提案はこの優先度と目標に沿って動きます。
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {focusItems.map((f) => (
              <li key={f.contactId} style={{ fontSize: 14, borderBottom: "1px solid #fde68a", paddingBottom: 8 }}>
                <div>
                  <Link href={`/contacts/${f.contactId}`} style={{ color: "#b45309", fontWeight: 600 }}>
                    {f.name}
                  </Link>
                  {f.company && <small style={{ color: "#92400e", marginLeft: 6 }}>{f.company}</small>}
                  {f.reasons.length > 0 && <span style={{ color: "#78350f", fontSize: 12, marginLeft: 8 }}>{f.reasons.join("・")}</span>}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <label style={{ fontSize: 12, color: "#92400e" }}>
                    距離感{" "}
                    <select
                      value={f.distance}
                      aria-label={`${f.name}さんの距離感`}
                      onChange={(e) => void saveFocusDistance(f.contactId, Number(e.target.value))}
                      style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #fcd34d", fontSize: 13 }}
                    >
                      <option value={1}>1 とても近い</option>
                      <option value={2}>2 近い</option>
                      <option value={3}>3 ふつう</option>
                      <option value={4}>4 遠め</option>
                      <option value={5}>5 年に一度</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 12, color: "#92400e" }}>
                    目標{" "}
                    <select
                      value={f.goal?.purpose ?? ""}
                      aria-label={`${f.name}さんとの関係の目標`}
                      onChange={(e) => void saveFocusGoal(f.contactId, e.target.value, f.goal?.targetDistance ?? Math.max(1, f.distance - 1))}
                      style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #fcd34d", fontSize: 13 }}
                    >
                      <option value="">決めていない</option>
                      <option value="business">仕事の間柄</option>
                      <option value="friend">友人</option>
                      <option value="romance">恋人・パートナー</option>
                      <option value="family">家族</option>
                      <option value="community">地域・コミュニティ</option>
                      <option value="other">その他</option>
                    </select>
                  </label>
                  {f.goal && (
                    <label style={{ fontSize: 12, color: "#92400e" }}>
                      目指す距離感{" "}
                      <select
                        value={f.goal.targetDistance}
                        aria-label={`${f.name}さんと目指す距離感`}
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
                    {f.focusPreference === "pinned" ? "印を外す" : "大切と印を付ける"}
                  </button>
                  <button
                    onClick={() => void saveFocusPreference(f.contactId, "excluded")}
                    style={{ background: "none", border: "none", color: "#a16207", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
                  >
                    このリストから外す
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {careItems.length > 0 && (
        <Fold k="cl21" title={<>あなたへの提案 ({careItems.length}件)</>} style={{ margin: "16px 0", border: "1px solid #a5b4fc", background: "#eef2ff", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#3730a3", margin: "4px 0 8px" }}>
            優先リストの方々について、次の一手をご用意しました。やるかどうかはあなたが選んでください。
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
                        setNotice("下の「追加する」の取り込み欄に、トーク履歴のファイルを置いてください");
                      }}
                      style={{ background: "none", border: "none", color: "#4338ca", cursor: "pointer", fontSize: 13, textDecoration: "underline", padding: 0 }}
                    >
                      取り込みへ進む
                    </button>
                  ) : (
                    <Link href={`/contacts/${s.contactId}`} style={{ color: "#4338ca", fontSize: 13 }}>
                      {s.kind === "reach_out" ? "お便りを考える" : s.kind === "meet" ? "日程のページを作る" : s.kind === "set_goal" ? "目標を決める" : "この方のページへ"}
                    </Link>
                  )}
                  <button onClick={() => void resolveCare(s.id, "done")} style={{ background: "none", border: "none", color: "#166534", cursor: "pointer", fontSize: 12, padding: 0 }}>
                    やりました
                  </button>
                  <button onClick={() => void resolveCare(s.id, "dismissed")} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 12, padding: 0 }}>
                    今回は見送る
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {shownGoalItems.length > 0 && (
        <Fold k="cl8" title={<>目標に向かっている関係</>} style={{ margin: "16px 0", border: "1px solid #ddd6fe", background: "#faf5ff", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#6b21a8", margin: "4px 0 8px" }}>
            目標を決めた方との、いまの間合いと次の一手です。間が空いてきた方から並べています。
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
                      {g.purposeLabel}・いま {g.current} → 目標 {g.target}
                      {g.plan.progress > 0 ? `・${g.plan.progress} 段階前進` : ""}
                      {g.plan.overdue ? "・間が空いています" : ""}
                    </span>
                  </span>
                  {dismissX(`${g.name}さんの目標の知らせを見送る`, () => dismissSuggestion("goal_nudge", g.contactId))}
                </div>
                <div style={{ color: "#4c1d95", marginTop: 2 }}>{g.plan.nextMove}</div>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {shownRecentMet.length > 0 && (
        <Fold k="cl9" title={<>最近お会いした方</>} style={{ margin: "16px 0", border: "1px solid #bae6fd", background: "#f0f9ff", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#075985", margin: "4px 0 8px" }}>
            お変わりありませんでしたか。覚えているうちにひとことだけ残しておくと、この先の一手がぐっと的確になります。
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {shownRecentMet.map((m) => (
              <li key={m.contactId} style={{ fontSize: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <Link href={`/contacts/${m.contactId}`} style={{ color: "#0369a1", fontWeight: 600 }}>
                  {m.name}
                </Link>
                <span style={{ color: "#0c4a6e", fontSize: 12 }}>{m.metAt} にお会いした記録</span>
                {dismissX(`${m.name}さんへのひとこと伺いを見送る`, () => dismissSuggestion("recent_meeting", `${m.contactId}:${m.metAt}`))}
                {metSaved[m.contactId] ? (
                  <span style={{ color: "#047857", fontSize: 13 }}>残しました。ありがとうございます</span>
                ) : (
                  <span style={{ display: "flex", gap: 6, flex: 1, minWidth: 220 }}>
                    <input
                      value={metNotes[m.contactId] ?? ""}
                      onChange={(e) => setMetNotes((s) => ({ ...s, [m.contactId]: e.target.value }))}
                      placeholder="ご様子をひとことだけ (例: お元気そう。秋に異動があるかもとのこと)"
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
                      残す
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {dailyQ && !dailySaved && !dailyQDismissed && (
        <Fold k="cl10" title={<>今日のひとこと</>} style={{ margin: "16px 0", border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 14, color: "#78350f", margin: "4px 0 8px" }}>{dailyQ.question}</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input
              value={dailyAnswer}
              onChange={(e) => setDailyAnswer(e.target.value)}
              placeholder="ひとことだけで大丈夫です (分からなければ空のままで)"
              style={{ flex: 1, minWidth: 220, padding: "6px 8px", border: "1px solid #fde68a", borderRadius: 8, fontSize: 13 }}
            />
            <button
              style={{ padding: "6px 14px", background: "#d97706", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
              onClick={async () => {
                if (await saveQuickNote(dailyQ.contactId, dailyAnswer)) {
                  setDailySaved(true);
                  setNotice(`${dailyQ.name}さんのことをひとつ覚えました。明日もひとつだけお聞きします`);
                }
              }}
            >
              残す
            </button>
            <button
              style={{ padding: "6px 10px", background: "transparent", color: "#92400e", border: "1px solid #fcd34d", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
              onClick={() => {
                setDailySaved(true);
                // 今日いっぱいは出さない (明日は別の一問がまた出る)
                dismissSuggestion("daily_question", `${dailyQ.contactId}:${todayKey}`);
              }}
            >
              今日はやめておく
            </button>
          </div>
          <p style={{ fontSize: 12, color: "#92400e", margin: "8px 0 0" }}>
            毎日ひとりについて、まだ書き留めていないことをひとつだけお聞きします。積み重なるほど、提案が的確になります。
          </p>
        </Fold>
      )}

      {shownFirstMoves.length > 0 && (
        <Fold k="cl11" title={<>新しく迎えた方へ、はじめの一手</>} style={{ margin: "16px 0", border: "1px solid #a7f3d0", background: "#ecfdf5", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#065f46", margin: "4px 0 8px" }}>
            最近お迎えした方のうち、いま動くとよさそうな方です。詳しい進め方は、お名前を開いて「この方への対応を考える」からどうぞ。
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
                {dismissX(`${m.name}さんへのはじめの一手を見送る`, () => dismissSuggestion("first_move", m.contactId))}
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 12, color: "#047857", margin: "8px 0 0" }}>
            お相手の論点整理は、材料のある方から順に自動で進みます。整うほど、この一手も具体的になります。
          </p>
        </Fold>
      )}

      <Fold k="cl22" title={<>あなたが力になれること</>} style={{ margin: "16px 0", border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 12, padding: "12px 16px" }}>
        <p style={{ fontSize: 13, color: "#166534", margin: "4px 0 8px" }}>
          あなたが提供できること（譲れるもの・貸せるもの・教えられること・手伝えること・相談にのれること）を書いておくと、
          それを必要としていそうな方を、これまでの記録からそっとお探しします。押しつけずに、最後はあなたが選べます。
        </p>
        {offerings.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", display: "grid", gap: 8 }}>
            {offerings.map((o) => (
              <li key={o.id} style={{ fontSize: 14, display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 200 }}>
                  <span style={{ color: "#15803d", fontWeight: 600 }}>{o.title}</span>
                  <span style={{ color: "#166534", fontSize: 12, marginLeft: 6 }}>
                    {o.kindLabel}
                    {o.maxDistance ? `・近い方 (距離 ${o.maxDistance} まで)` : ""}
                    {o.published ? "・掲示板に公開中" : ""}
                  </span>
                </span>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#166534", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={o.published}
                    onChange={(e) => void toggleOfferingPublished(o.id, e.target.checked)}
                  />
                  掲示板に載せる
                </label>
                <button
                  aria-label={`${o.title} を消す`}
                  onClick={() => void removeOffering(o.id)}
                  style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: 2 }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {marketUrl && offerings.some((o) => o.published) && (
          <p style={{ fontSize: 12, color: "#166534", margin: "0 0 10px" }}>
            公開ページ:{" "}
            <a href="/market" target="_blank" rel="noopener noreferrer" style={{ color: "#15803d" }}>
              できること・お時間のご案内
            </a>
            （この URL を、届けたい方に共有できます）
          </p>
        )}
        {offerInterests.length > 0 && (
          <div style={{ margin: "10px 0", border: "1px solid #86efac", background: "#dcfce7", borderRadius: 10, padding: "10px 12px" }}>
            <p style={{ fontSize: 13, color: "#166534", margin: "0 0 6px", fontWeight: 600 }}>
              掲示板へのお問い合わせが {offerInterests.length} 件あります
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {offerInterests.map((it) => (
                <li key={it.id} style={{ fontSize: 14 }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>{it.guestName}</span>
                    <span style={{ color: "#166534", fontSize: 12, marginLeft: 6 }}>
                      「{it.offeringTitle}」{it.guestContact ? `・${it.guestContact}` : ""}
                    </span>
                  </div>
                  {it.message && <div style={{ color: "#334155", marginTop: 2 }}>{it.message}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button
                      onClick={() => void approveInterest(it.id)}
                      style={{ padding: "5px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                    >
                      連絡先に迎える
                    </button>
                    <button
                      onClick={() => void dismissInterest(it.id)}
                      style={{ padding: "5px 12px", background: "#fff", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                    >
                      今回は見送る
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
              placeholder="何ができますか (例: 英語を教えられます・使わない子ども服を譲れます)"
              style={{ padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14 }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select
                aria-label="申し出の種類"
                value={offerKind}
                onChange={(e) => setOfferKind(e.target.value)}
                style={{ padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14 }}
              >
                {offerKinds.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
              <select
                aria-label="お声がけする範囲 (距離感)"
                value={offerMaxDist}
                onChange={(e) => setOfferMaxDist(e.target.value)}
                style={{ padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14 }}
              >
                <option value="">どなたでも</option>
                <option value="2">とても近い方だけ (2 まで)</option>
                <option value="3">近い方まで (3 まで)</option>
                <option value="4">ふだん付き合いのある方まで (4 まで)</option>
              </select>
            </div>
            <input
              value={offerDesc}
              onChange={(e) => setOfferDesc(e.target.value)}
              placeholder="補足があれば (例: 平日夜のオンラインなら・ビジネス英語も可)"
              style={{ padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => void addOffering()}
                style={{ padding: "8px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
              >
                登録する
              </button>
              <button
                onClick={() => setShowOfferForm(false)}
                style={{ padding: "8px 16px", background: "#fff", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
              >
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowOfferForm(true)}
            style={{ padding: "6px 14px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, marginBottom: 8 }}
          >
            力になれることを書く
          </button>
        )}
        {offerMatches.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <p style={{ fontSize: 13, color: "#166534", margin: "8px 0 6px", fontWeight: 600 }}>
              力になれそうな方が見つかりました
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
                          <span style={{ color: "#047857", fontSize: 13 }}>控えました</span>
                        ) : (
                          <button
                            onClick={() => void offerToContact(m.offeringId, ct.contactId, m.title, m.kindLabel)}
                            style={{ padding: "5px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                          >
                            この方に申し出る
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

      <Fold k="cl12" title={<>引き合わせるとよいお二人</>} style={{ margin: "16px 0", border: "1px solid #ddd6fe", background: "#faf5ff", borderRadius: 12, padding: "12px 16px" }}>
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
                  setError(body.detail ?? "いまは提案を作れませんでした");
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "考えています…" : "見つけてもらう"}
          </button>
        </div>
        <p style={{ fontSize: 13, color: "#6b21a8", margin: "6px 0 0" }}>
          連絡帳の中から、一方の困りごとや目標に、もう一方の強みや力になれることが噛み合いそうなお二人を、そっとお知らせします。
        </p>
        {intros && intros.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 10 }}>
            {intros.map((it, i) => (
              <li key={i} style={{ background: "#fff", border: "1px solid #e9d5ff", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontWeight: 700, color: "#5b21b6" }}>{it.personA} と {it.personB}</div>
                {it.reason && <div style={{ fontSize: 14, marginTop: 3, lineHeight: 1.8 }}>{it.reason}</div>}
                {it.how && <div style={{ fontSize: 13, color: "#475569", marginTop: 3 }}>引き合わせ方: {it.how}</div>}
                {it.caution && <div style={{ fontSize: 13, color: "#92400e", marginTop: 3 }}>{it.caution}</div>}
              </li>
            ))}
          </ul>
        )}
        {intros && intros.length === 0 && (
          <p style={{ fontSize: 13, color: "#6b7280", margin: "8px 0 0" }}>
            {introNote || "いまのところ、はっきり噛み合うお二人は見当たりませんでした。"}
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
            s === "queued" ? "待機中" : s === "processing" ? "読み取り中" : s === "done" ? "完了" : "読み取れませんでした";
          const color = (s: string) =>
            s === "done" ? "#166534" : s === "error" ? "#b91c1c" : "#1e40af";
          return (
            <Fold k="cl13" title={<>取り込みの状況</>}
              style={{ margin: "16px 0", border: "1px solid #bfdbfe", background: "#eff6ff", borderRadius: 12, padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                {active === 0 && (
                  <button
                    onClick={() => void clearJobs()}
                    style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13 }}
                  >
                    表示を片付ける
                  </button>
                )}
              </div>
              <p style={{ color: "#475569", fontSize: 13, margin: "4px 0 10px" }}>
                {active > 0
                  ? "サーバで読み取りが進んでいます。ページを離れたり、ほかのことをしていても大丈夫です。"
                  : "取り込みが終わりました。"}
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                {jobs.slice(0, 30).map((j) => (
                  <li key={j.id} style={{ fontSize: 14, display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {j.filename || (j.kind === "text" ? "貼り付けた内容" : "ファイル")}
                    </span>
                    <span style={{ color: color(j.status), whiteSpace: "nowrap" }}>
                      {label(j.status)}
                      {j.status === "done" &&
                        (j.imported > 0 || j.enriched > 0
                          ? `（${j.imported > 0 ? `${j.imported}名を追加` : ""}${j.imported > 0 && j.enriched > 0 ? "・" : ""}${j.enriched > 0 ? `${j.enriched}名に追記` : ""}）`
                          : "（新しい方はいませんでした）")}
                    </span>
                  </li>
                ))}
              </ul>
            </Fold>
          );
        })()}

      {dupeGroups.length > 0 && (
        <Fold k="cl14" title={<>同じ方が二重に登録されているかもしれません</>} style={{ margin: "16px 0", border: "1px solid #bfdbfe", background: "#eff6ff", borderRadius: 12, padding: "12px 16px" }}>
          <p style={{ color: "#475569", fontSize: 13, margin: "0 0 10px" }}>
            まとめると、やりとりや贈り物の記録も1件に集まります。別の方なら、そのままにしておいて大丈夫です。
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {dupeGroups.slice(0, 20).map((g, i) => (
              <li key={i} style={{ border: "1px solid #dbeafe", borderRadius: 10, padding: "10px 12px", background: "#fff" }}>
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 4 }}>
                  {g.reason}
                  {!g.strong && "（念のためご確認ください）"}
                </div>
                <div style={{ fontSize: 14 }}>
                  {g.members.map((m) => (
                    <span key={m.id} style={{ marginRight: 12 }}>
                      {m.name}
                      {m.company && <span style={{ color: "#94a3b8" }}> ({m.company})</span>}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => void mergeGroup(g)}
                  disabled={busy}
                  style={{ marginTop: 8, padding: "6px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                >
                  1件にまとめる
                </button>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      <Fold k="cl15" title={<>{t("add_section")}</>} style={{ margin: "24px 0" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder={t("name_placeholder")}
            aria-label="お名前"
            style={{ flex: 1, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8 }}
          />
          <select
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            aria-label="距離感"
            style={{ padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8 }}
          >
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>{DISTANCE_LABEL[d]}</option>
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
            aria-label="同じお名前の確認"
            style={{
              border: "1px solid #bfdbfe",
              background: "#eff6ff",
              borderRadius: 12,
              padding: 16,
              marginTop: 12,
            }}
          >
            <p style={{ margin: "0 0 10px", fontWeight: 600 }}>
              「{pendingName}」というお名前の方がすでに連絡帳にいます。同じ方でしょうか。
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
                    {[d.company, d.title].filter(Boolean).join(" ") || "所属の記録なし"}
                    {" ・ "}
                    {DISTANCE_LABEL[d.distance] ?? ""}
                    {" ・ 同じ方ならこちらを開いて追記してください"}
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
                別の人として追加する
              </button>
              <button
                onClick={() => {
                  setDuplicates(null);
                  setPendingName("");
                }}
                disabled={busy}
                style={{ padding: "8px 14px", background: "none", border: "none", color: "#64748b", cursor: "pointer" }}
              >
                やめる
              </button>
            </div>
          </section>
        )}
        <p style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowImport(!showImport)}
            style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}
          >
            {showImport ? "取り込みを閉じる" : "ファイルや写真からまとめて取り込む (名刺・名簿の写真・SNSのダウンロードデータ・連絡先・トーク履歴)"}
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
              ここにファイルや写真、フォルダを置くか、押して選んでください
              <br />
              <small style={{ color: "#64748b" }}>
                名刺や名簿の写真、ZIP・Word・Excel・PDF・メール・メモまで、どんな形でも大丈夫です。お相手の情報を読み取って整理します
              </small>
              <input
                type="file"
                multiple
                aria-label="取り込みファイル"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) void uploadFiles(e.target.files);
                  e.target.value = "";
                }}
                style={{ display: "none" }}
              />
            </label>
            <p style={{ margin: "0 0 8px", textAlign: "center", display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
              <label style={{ color: "#2563eb", cursor: "pointer", fontSize: 14 }}>
                名刺や名簿を撮って取り込む
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  aria-label="写真をとって取り込む"
                  {...({ capture: "environment" } as Record<string, string>)}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) void uploadFiles(e.target.files);
                    e.target.value = "";
                  }}
                  style={{ display: "none" }}
                />
              </label>
              <label style={{ color: "#2563eb", cursor: "pointer", fontSize: 14 }}>
                フォルダごと選んで取り込む
                <input
                  type="file"
                  multiple
                  aria-label="取り込みフォルダ"
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
              <summary style={{ cursor: "pointer", color: "#2563eb" }}>各サービスからの取り出し方 (かんたん手順)</summary>
              <div style={{ padding: "8px 4px", display: "grid", gap: 10, fontSize: 14 }}>
                <div>
                  <strong>名刺・名簿・年賀状の写真</strong> — スマホなら「名刺や名簿を撮って取り込む」から、その場で
                  撮って取り込めます。手元の写真やスクリーンショット (連絡先アプリ・LINE の友だち一覧など) も、
                  ここに置けば写っているお名前・連絡先・ご所属を読み取って整理します。何枚かまとめてでも大丈夫です。
                </div>
                <div>
                  <strong>LINE</strong> — トーク画面の右上メニュー → 設定 → トーク履歴を送信、で作られる
                  テキストファイルをここに置いてください。お相手の登録と、やりとりの記録が一度に入ります。
                  トークの中身からお相手の近況 (引っ越し・お仕事・体調など) も短いメモに自動で整理して添えます。
                </div>
                <div>
                  <strong>LinkedIn</strong> —{" "}
                  <a href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                    データのダウンロード
                  </a>
                  で「Connections」を選んで受け取った ZIP か CSV をそのまま。
                </div>
                <div>
                  <strong>Facebook / Instagram</strong> —{" "}
                  <a href="https://accountscenter.facebook.com/info_and_permissions/dyi" target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                    アカウントセンターの「情報をダウンロード」
                  </a>
                  で、対象を友達 (フォロー) だけ・形式は JSON にすると小さくなります。届いた ZIP をそのまま。
                </div>
                <div>
                  <strong>X</strong> —{" "}
                  <a href="https://x.com/settings/download_your_data" target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                    設定の「データのアーカイブをダウンロード」
                  </a>
                  で受け取った ZIP をそのまま。
                </div>
                <div>
                  <strong>Google 連絡先</strong> —{" "}
                  <a href="https://contacts.google.com" target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                    contacts.google.com
                  </a>
                  の「エクスポート」で受け取った CSV か vCard を。スマホの連絡先アプリの書き出し (vCard) も使えます。
                </div>
                <div>
                  <strong>名刺 (Eight)・年賀状リスト・ほかの管理表</strong> — CSV のままで大丈夫です。lms
                  の「データを書き出す」で作ったファイルもそのまま取り込めます。
                </div>
                <div>
                  <strong>そのほかの書類・フォルダ</strong> — 名簿の Excel、案内状の
                  Word、議事録の PDF、いただいたメール (.eml)、自由なメモまで、文字の入った書類なら
                  たいてい読み取れます。フォルダごと置けば、中の書類をまとめて確かめ、お名前・連絡先・
                  所属・近況・お会いした日を整理して連絡帳に足します。すでにいる方は、空いている項目の
                  補完とメモの書き足しだけ行い、あなたが書いた内容は上書きしません。
                </div>
              </div>
            </details>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="貼り付けでも取り込めます (CSV・vCard・LINE のトーク履歴など)"
              aria-label="取り込み内容"
              rows={6}
              style={{ width: "100%", padding: 10, border: "1px solid #e2e8f0", borderRadius: 8 }}
            />
            <button
              onClick={() => void runImport()}
              disabled={busy || !importText.trim()}
              style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
            >
              取り込む
            </button>
          </div>
        )}
        <p style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowConv(!showConv)}
            style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}
          >
            {showConv ? "会話からの取り込みを閉じる" : "会話やメモから取り込む (音声の文字起こしにも対応)"}
          </button>
        </p>
        {showConv && (
          <div>
            <p style={{ margin: "4px 0", color: "#64748b", fontSize: 14 }}>
              打ち合わせのメモ、日記、ボイスレコーダーの文字起こしなどを貼り付けると、
              登場したお相手と近況を読み取ってご提案します。反映するかどうかはあなたが選べます。
            </p>
            <textarea
              value={convText}
              onChange={(e) => setConvText(e.target.value)}
              placeholder="例: 昨日は田中さんとお茶。お孫さんが生まれたばかりで嬉しそうだった。"
              aria-label="会話の内容"
              rows={5}
              style={{ width: "100%", padding: 10, border: "1px solid #e2e8f0", borderRadius: 8 }}
            />
            <button
              onClick={() => void extractFromConversation()}
              disabled={busy || !convText.trim()}
              style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
            >
              お相手と近況をさがす
            </button>
            {proposals.length > 0 && (
              <div style={{ marginTop: 10, border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 14px" }}>
                <p style={{ margin: "0 0 8px", color: "#334155" }}>見つかったお相手 (反映するものを選んでください)</p>
                <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
                  {proposals.map((p, i) => (
                    <li key={`${p.name}-${i}`} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <input
                        type="checkbox"
                        checked={p.selected}
                        aria-label={`${p.name}を反映`}
                        onChange={(e) =>
                          setProposals((prev) => prev.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))
                        }
                        style={{ marginTop: 4 }}
                      />
                      <span>
                        <strong>{p.name}</strong>
                        {p.contactId ? (
                          <small style={{ color: "#64748b", marginLeft: 6 }}>登録済みの方 (近況を書き足します)</small>
                        ) : (
                          <small style={{ color: "#0891b2", marginLeft: 6 }}>新しく登録します</small>
                        )}
                        {p.date && <small style={{ color: "#64748b", marginLeft: 6 }}>{p.date} に会った記録も</small>}
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
                  選んだ方を記録に反映する
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
            {showCalendar ? "予定表の接続を閉じる" : "ご自身の予定表とつなぐ (面談候補の精度が上がります)"}
          </button>
        </p>
        {showCalendar && (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={icsUrl}
              onChange={(e) => setIcsUrl(e.target.value)}
              placeholder="カレンダーの共有アドレス (https://...ics)"
              aria-label="予定表アドレス"
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
                  setNotice(`予定表をつなぎました (${body.saved}件の予定を取り込み)`);
                  setIcsUrl("");
                  setShowCalendar(false);
                } else {
                  setError(body.detail ?? "予定表をつなげませんでした");
                }
              }}
              disabled={busy || !icsUrl.trim()}
              style={{ padding: "10px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
            >
              つなぐ
            </button>
            <button
              onClick={async () => {
                const res = await apiFetch("relationship/refresh-calendars", { method: "POST", body: "{}" });
                const body = await res.json().catch(() => ({}));
                if (res.ok) setNotice(`予定表を最新にしました (${body.refreshed}件)`);
              }}
              style={{ padding: "10px 12px", border: "1px solid #2563eb", color: "#2563eb", background: "#fff", borderRadius: 8, cursor: "pointer" }}
            >
              最新にする
            </button>
          </div>
        )}
        {showCalendar && (
          <p style={{ color: "#94a3b8", fontSize: 12, margin: "8px 0 0", lineHeight: 1.7 }}>
            Outlook は予定表の共有 (ICS) アドレスを、Google カレンダーは設定の「非公開の ICS 形式アドレス」を貼ると、
            ご予定をふまえた面談候補が出せます。一度つなぐと、最新にするボタンで取り直せます。
          </p>
        )}
      </section>

      <Fold k="cl18" title={<>SNS・サービスと連携して、関係する人をまとめる</>} style={{ margin: "24px 0", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        <p style={{ color: "#64748b", margin: "4px 0 10px", fontSize: 14 }}>
          お使いのサービスから、つながっている方をまとめて連絡帳に取り込めます。各社のボタンを押すと、
          その取り出し方のページが開きます。受け取ったファイルを下の取り込みに置くだけで大丈夫です。
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SNS_CONNECTORS.map((s) => (
            <button
              key={s.key}
              onClick={() => {
                window.open(s.url, "_blank", "noopener,noreferrer");
                setConnectHint(s.hint);
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
              {s.label} とつなぐ
            </button>
          ))}
        </div>
        {connectHint && (
          <p aria-live="polite" style={{ margin: "10px 0 0", color: "#1e40af", background: "#eff6ff", padding: 10, borderRadius: 8, fontSize: 14 }}>
            {connectHint}
          </p>
        )}
      </Fold>

      <Fold k="cl19" title={<>いちばん簡単: Google（連絡先・カレンダー）からまとめて取り込む</>} style={{ margin: "24px 0", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        <p style={{ color: "#64748b", margin: "4px 0 10px", fontSize: 14 }}>
          ボタンをひとつ押すだけで、Google の連絡先（アドレス帳）とカレンダーの同席者が連絡帳へ自動でまとまります。
          つないだあとはその場で取り込みが始まります。読み取りだけの最小限の権限で、予定やアドレス帳を書き換えることはありません。
        </p>
        {googleStatus === null && <p style={{ color: "#64748b" }}>確認しています…</p>}
        {googleStatus?.available === false && (
          <p style={{ color: "#64748b" }}>この機能は準備中です (運営者側の接続設定が済むと使えるようになります)。</p>
        )}
        {googleStatus?.available && !googleStatus.connected && (
          <button
            onClick={async () => {
              const res = await apiFetch("google/auth-url");
              const body = await res.json().catch(() => ({}));
              if (res.ok && body.url) window.location.href = body.url;
              else setError(body.detail ?? "いまはつなげませんでした");
            }}
            disabled={busy}
            style={{ padding: "10px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
          >
            Google とつないで取り込む
          </button>
        )}
        {googleStatus?.available && googleStatus.connected && (
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#166534" }}>
              つながっています{googleStatus.email ? ` (${googleStatus.email})` : ""}
            </span>
            {googleStatus.lastSyncNote && (
              <small style={{ color: "#64748b" }}>前回: {googleStatus.lastSyncNote}</small>
            )}
            <button
              onClick={() => void syncGoogle()}
              disabled={busy}
              style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
            >
              いま取り込む
            </button>
          </div>
        )}
        {googleStatus?.available && googleStatus.connected && !googleStatus.extended && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #e2e8f0" }}>
            <p style={{ color: "#64748b", margin: "0 0 8px", fontSize: 13, lineHeight: 1.8 }}>
              さらに、メールでやりとりした相手や共有ファイルの仲間も拾えます（メールは宛先と件名だけで本文は読みません）。
              こちらは追加の確認画面が出ます。使いたいときだけどうぞ。
            </p>
            <button
              onClick={async () => {
                const res = await apiFetch("google/auth-url?scope=extended");
                const body = await res.json().catch(() => ({}));
                if (res.ok && body.url) window.location.href = body.url;
                else setError(body.detail ?? "いまはつなげませんでした");
              }}
              disabled={busy}
              style={{ padding: "8px 16px", background: "#fff", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer" }}
            >
              メール・共有ファイルの相手も拾えるようにする
            </button>
          </div>
        )}
      </Fold>

      <Fold k="cl20" title={<>{t("everyone")} ({totalContacts ?? contacts.length})</>}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <input
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder="お名前・ふりがな・ローマ字・メール・電話・会社などで探す"
            style={{ flex: 1, minWidth: 200, padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14 }}
          />
          {contacts.length > 30 && !nameFilter && (
            <button
              onClick={() => setShowAll((v) => !v)}
              style={{ padding: "8px 14px", background: "transparent", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
            >
              {showAll ? "一覧を畳む" : `すべて表示する (${contacts.length}名)`}
            </button>
          )}
        </div>
        {contacts.length > 30 && !showAll && !nameFilter && (
          <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 8px" }}>
            人数が多いため一覧は畳んでいます。上の「大切にしたい方々」から開くか、検索してください。全員の記録はそのまま残っています。
          </p>
        )}
        {nameFilter.trim() && searchResults && (
          <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 8px" }}>
            全員の中から {searchResults.length} 名が見つかりました{searchResults.length >= 100 ? " (多いため先頭の100名まで)" : ""}
          </p>
        )}
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {(nameFilter.trim()
            ? (searchResults ?? [])
            : contacts.length > 30 && !showAll
              ? []
              : contacts
          ).map((c) => (
            <li key={c.id}>
              <Link
                href={`/contacts/${c.id}`}
                style={{
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
                <small style={{ color: "#64748b" }}>{DISTANCE_LABEL[c.distance] ?? ""}</small>
              </Link>
            </li>
          ))}
          {contacts.length === 0 && <li style={{ color: "#64748b" }}>まだ登録がありません。大切な方から登録してみましょう。</li>}
        </ul>
      </Fold>
    </main>
  );
}
