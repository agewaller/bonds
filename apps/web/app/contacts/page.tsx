"use client";
// 連絡帳 + つながりスコア + 「今日、連絡してみませんか」(lms の関係性ダッシュボードを移植)。
// 文言は寄り添い基調・技術語なし・記号装飾なし (CLAUDE.md 共通プロダクト原則)。
import { useCallback, useEffect, useState } from "react";
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
  const [dragOver, setDragOver] = useState(false);
  const [convText, setConvText] = useState("");
  const [showConv, setShowConv] = useState(false);
  const [proposals, setProposals] = useState<
    { name: string; note: string; date: string | null; contactId: string | null; selected: boolean }[]
  >([]);
  const [icsUrl, setIcsUrl] = useState("");
  const [showCalendar, setShowCalendar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // 同姓同名の確認 (null = 非表示)。既存の同名者を見せて「同じ人か別の人か」を選んでもらう
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const [pendingName, setPendingName] = useState("");
  // Google 連携 (null = 確認中)
  const [googleStatus, setGoogleStatus] = useState<{
    available: boolean;
    connected: boolean;
    email?: string | null;
    lastSyncNote?: string | null;
  } | null>(null);
  // 贈り物の行事 (いま贈るとよい方)
  const [giftOccasions, setGiftOccasions] = useState<
    { kind: string; contactId: string | null; contactName: string | null; label: string; daysUntil: number; note: string }[]
  >([]);

  const load = useCallback(async () => {
    const [cRes, sRes, pRes, gRes] = await Promise.all([
      apiFetch("contacts"),
      apiFetch("relationship/summary"),
      apiFetch("relationship/progress"),
      apiFetch("gifts/occasions"),
    ]);
    if (cRes.ok) setContacts((await cRes.json()).contacts);
    if (sRes.ok) setSummary(await sRes.json());
    if (pRes.ok) setProgress(await pRes.json());
    if (gRes.ok) setGiftOccasions((await gRes.json()).occasions ?? []);
  }, []);

  useEffect(() => {
    void load();
    void (async () => {
      const res = await apiFetch("google/status");
      setGoogleStatus(res.ok ? await res.json() : { available: false, connected: false });
    })();
    // Google 同意画面から戻ってきたときの案内 (アドレスからは印を消す)
    const params = new URLSearchParams(window.location.search);
    const g = params.get("google");
    if (g) {
      if (g === "connected") setNotice("Google とつながりました。「いま取り込む」でお相手を取り込めます");
      if (g === "error") setError("Google との接続がうまくいきませんでした。もう一度お試しください");
      params.delete("google");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, [load]);

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
    try {
      const res = await apiFetch("contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: importText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail ?? "取り込めませんでした");
        return;
      }
      const sameName: string[] = Array.isArray(body.sameName) ? body.sameName : [];
      setNotice(
        sameName.length > 0
          ? `${body.imported}件の連絡先を取り込みました。同じお名前の方がすでにいるため見送った分があります (${sameName.join("、")})。別の方でしたら、上の追加欄からもう一度お名前を入れてください`
          : `${body.imported}件の連絡先を取り込みました`,
      );
      setImportText("");
      setShowImport(false);
      await load();
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
    let imported = 0;
    let interactions = 0;
    let enriched = 0;
    const sameNames = new Set<string>();
    const problems: string[] = [];
    let unreadable = 0;
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i]!;
        const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        if (list.length > 1) setNotice(`読み取っています (${i + 1}/${list.length}件目): ${path}`);
        const res = await apiFetch(`contacts/import-file?filename=${encodeURIComponent(path)}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: await file.arrayBuffer(),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (body.error === "no_contacts_found") unreadable++;
          else problems.push(`${path}: ${body.detail ?? "取り込めませんでした"}`);
          continue;
        }
        imported += body.imported ?? 0;
        interactions += body.interactionsAdded ?? 0;
        enriched += body.enriched ?? 0;
        if (Array.isArray(body.sameName)) body.sameName.forEach((n: string) => sameNames.add(n));
      }
      const parts: string[] = [];
      if (imported > 0) parts.push(`${imported}件の連絡先を取り込みました`);
      if (enriched > 0) parts.push(`すでにいる${enriched}名の記録に、分かったことを書き足しました`);
      if (interactions > 0) parts.push(`やりとりの記録を${interactions}件残しました`);
      if (unreadable > 0 && parts.length > 0) parts.push(`人物情報の見つからないファイルが${unreadable}件ありました`);
      if (parts.length > 0) {
        const dup =
          sameNames.size > 0 && enriched === 0
            ? `。同じお名前の方がすでにいるため見送った分があります (${[...sameNames].slice(0, 10).join("、")})。別の方でしたら追加欄からお名前を入れてください`
            : "";
        setNotice(`${parts.join("。")}${dup}`);
        await load();
      } else if (unreadable > 0 && problems.length === 0) {
        setError(
          unreadable === 1
            ? "このファイルからは人物にまつわる情報を見つけられませんでした"
            : `${unreadable}件のファイルからは人物にまつわる情報を見つけられませんでした`,
        );
        setNotice("");
      } else {
        setNotice("");
      }
      if (problems.length > 0) setError(problems.slice(0, 5).join(" / ") + (problems.length > 5 ? ` ほか${problems.length - 5}件` : ""));
    } finally {
      setBusy(false);
    }
  };

  // 会話やメモから登場人物と近況をさがす (提案どまり。反映はユーザーが選ぶ)
  const extractFromConversation = async () => {
    if (!convText.trim() || busy) return;
    setBusy(true);
    setError("");
    setProposals([]);
    try {
      const res = await apiFetch("contacts/extract-from-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: convText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail ?? "いまは読み取れませんでした");
        return;
      }
      const list = (body.proposals ?? []) as { name: string; note: string; date: string | null; contactId: string | null }[];
      if (list.length === 0) {
        setNotice("この内容からはお相手を見つけられませんでした");
        return;
      }
      setProposals(list.map((p) => ({ ...p, selected: true })));
    } finally {
      setBusy(false);
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

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <LanguageSelector />
        <AuthBar />
      </div>
      <p>
        <Link href="/" style={{ color: "#2563eb" }}>{t("back_home")}</Link>
      </p>
      <h1 style={{ fontSize: 24 }}>{t("contacts_title")}</h1>

      {summary && (
        <section
          style={{
            borderLeft: `5px solid ${level.color}`,
            background: "#f8fafc",
            borderRadius: 12,
            padding: "12px 16px",
            margin: "16px 0",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>{t("connection_score")}</h2>
            <div style={{ fontSize: 28, color: level.color }}>
              {summary.connectionScore}
              <small style={{ fontSize: 14, color: "#64748b" }}>/100</small>
            </div>
          </div>
          <p style={{ margin: "4px 0", color: level.color }}>{level.label}</p>
          <p style={{ margin: 0, color: "#334155" }}>{level.message}</p>
        </section>
      )}

      {progress && progress.totalInteractions > 0 && (
        <section style={{ background: "#f8fafc", borderRadius: 12, padding: "12px 16px", margin: "16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>これまでの歩み</h2>
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
        </section>
      )}

      {summary && summary.today.length > 0 && (
        <section style={{ margin: "16px 0" }}>
          <h2 style={{ fontSize: 18 }}>{t("today_suggestion")}</h2>
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
        </section>
      )}
      {summary && summary.today.length === 0 && contacts.length > 0 && (
        <p style={{ color: "#27ae60" }}>すべての方と適切な頻度でつながれています。素晴らしいですね。</p>
      )}

      {giftOccasions.length > 0 && (
        <section style={{ margin: "16px 0", border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 12, padding: "12px 16px" }}>
          <h2 style={{ fontSize: 17, marginTop: 0 }}>いま贈るとよい方・行事</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {giftOccasions.slice(0, 8).map((o, i) => (
              <li key={i} style={{ fontSize: 14 }}>
                {o.contactId ? (
                  <Link href={`/contacts/${o.contactId}`} style={{ color: "#b45309", fontWeight: 600 }}>
                    {o.label}
                  </Link>
                ) : (
                  <span style={{ fontWeight: 600 }}>{o.label}</span>
                )}
                <span style={{ color: "#78716c" }}> — {o.note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>
          {error}
        </p>
      )}

      <section style={{ margin: "24px 0" }}>
        <h2 style={{ fontSize: 18 }}>{t("add_section")}</h2>
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
      </section>

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
      </section>

      <section style={{ margin: "24px 0", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>Google とつなぐ</h2>
        <p style={{ color: "#64748b", margin: "4px 0 10px", fontSize: 14 }}>
          Google の連絡先 (アドレス帳) はもちろん、カレンダーの同席者、メールのやりとりの相手、共有ファイルの仲間まで、
          連絡帳へ自動で取り込みます。読み取りだけの最小限の権限で、メールの本文は読みません。
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
            Google とつなぐ
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
              onClick={async () => {
                if (busy) return;
                setBusy(true);
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
                  setNotice(`Google から連絡先${body.imported}件、やりとりの記録${body.interactionsAdded}件を取り込みました${dup}`);
                  await load();
                  const s = await apiFetch("google/status");
                  if (s.ok) setGoogleStatus(await s.json());
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
            >
              いま取り込む
            </button>
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18 }}>{t("everyone")} ({contacts.length})</h2>
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {contacts.map((c) => (
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
      </section>
    </main>
  );
}
