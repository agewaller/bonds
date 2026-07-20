// 相手の SNS 情報の理解 — 純粋関数のみ (DB/ネット非依存 = ユニット対象)。
// contacts.sns は暗号化された自由記述。ここでは「platform ごとの公開アカウント」に
// 構造化し、公開プロフィール URL を組み立て、近況把握のための検索クエリを作る。
// 方針: 公開情報のみ・友人グラフ OAuth は取らない (INTEGRATIONS.md)・相手の尊厳を守る。

export type SnsEntry = {
  platform: string; // x / instagram / facebook / linkedin / note / youtube / tiktok / threads / github / blog
  handle: string; // 表示用 (@なし)。URL しか無い場合は URL の末尾から推定
  url: string; // 公開プロフィール URL (辿れるもの)
};

const PLATFORM_LABEL: Record<string, string> = {
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

export function snsPlatformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

// ホスト名 (小文字) から platform を判定する。未知は blog 扱い。
function platformFromHost(host: string): string {
  const h = host.replace(/^www\./, "");
  if (h === "twitter.com" || h === "x.com" || h === "mobile.twitter.com") return "x";
  if (h === "instagram.com") return "instagram";
  if (h === "facebook.com" || h === "fb.com" || h === "m.facebook.com") return "facebook";
  if (h === "linkedin.com" || h.endsWith(".linkedin.com")) return "linkedin";
  if (h === "note.com") return "note";
  if (h === "youtube.com" || h === "youtu.be" || h === "m.youtube.com") return "youtube";
  if (h === "tiktok.com") return "tiktok";
  if (h === "threads.net" || h === "threads.com") return "threads";
  if (h === "github.com") return "github";
  return "blog";
}

// "@handle" や "twitter: foo" のような素の記述から platform を推定する。
function platformFromToken(token: string): string | null {
  const t = token.trim().toLowerCase();
  if (/^x$|^twitter$/.test(t)) return "x";
  if (t === "instagram" || t === "insta" || t === "ig") return "instagram";
  if (t === "facebook" || t === "fb") return "facebook";
  if (t === "linkedin") return "linkedin";
  if (t === "note") return "note";
  if (t === "youtube" || t === "yt") return "youtube";
  if (t === "tiktok") return "tiktok";
  if (t === "threads") return "threads";
  if (t === "github") return "github";
  return null;
}

// platform + handle から公開プロフィール URL を作る。作れないものは空。
function profileUrl(platform: string, handle: string): string {
  const h = handle.replace(/^@/, "").trim();
  if (!h) return "";
  switch (platform) {
    case "x":
      return `https://x.com/${h}`;
    case "instagram":
      return `https://www.instagram.com/${h}/`;
    case "facebook":
      return `https://www.facebook.com/${h}`;
    case "linkedin":
      return `https://www.linkedin.com/in/${h}`;
    case "note":
      return `https://note.com/${h}`;
    case "youtube":
      return h.startsWith("@") ? `https://www.youtube.com/${h}` : `https://www.youtube.com/@${h}`;
    case "tiktok":
      return `https://www.tiktok.com/@${h}`;
    case "threads":
      return `https://www.threads.net/@${h}`;
    case "github":
      return `https://github.com/${h}`;
    default:
      return "";
  }
}

// URL から handle を推定する (パスの最初のセグメント。@ は落とす)。
function handleFromUrl(u: URL): string {
  const seg = u.pathname.split("/").filter(Boolean);
  if (seg.length === 0) return u.hostname.replace(/^www\./, "");
  // linkedin は /in/xxx、youtube は /@xxx
  const first = seg[0]!.replace(/^@/, "");
  if ((first === "in" || first === "pub") && seg[1]) return seg[1]!;
  return first;
}

// 1 行 (URL か "platform: handle" か素の @handle) を SnsEntry に。読めなければ null。
function parseLine(raw: string): SnsEntry | null {
  const line = raw.trim().replace(/^[-*・]\s*/, "");
  if (!line) return null;
  // URL を含むなら URL 優先
  const urlMatch = line.match(/https?:\/\/[\x21-\x7e]+/);
  if (urlMatch) {
    try {
      const u = new URL(urlMatch[0]);
      const platform = platformFromHost(u.hostname.toLowerCase());
      const handle = handleFromUrl(u);
      const url = platform === "blog" ? u.toString() : profileUrl(platform, handle) || u.toString();
      return { platform, handle, url };
    } catch {
      return null;
    }
  }
  // "platform: handle" 形式
  const kv = line.match(/^([A-Za-z]+)\s*[:：]\s*(.+)$/);
  if (kv) {
    const platform = platformFromToken(kv[1]!);
    const handle = kv[2]!.trim().replace(/^@/, "");
    if (platform && handle) return { platform, handle, url: profileUrl(platform, handle) };
  }
  // 素の @handle は platform 不明。X を既定にせず blog 扱いにはできないので落とす
  return null;
}

// contacts.sns (自由記述 / JSON 文字列 / 改行やカンマ区切り) を構造化する。
export function parseSnsField(sns: string | null | undefined): SnsEntry[] {
  if (!sns) return [];
  let text = sns.trim();
  // 取込で JSON 配列/オブジェクトが入ることがある
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const out: SnsEntry[] = [];
      for (const item of arr) {
        if (typeof item === "string") {
          const e = parseLine(item);
          if (e) out.push(e);
        } else if (item && typeof item === "object") {
          const cand = (item.url ?? item.href ?? item.value ?? item.handle ?? "") as string;
          const e = parseLine(String(cand));
          if (e) out.push(e);
        }
      }
      return dedupe(out);
    } catch {
      // JSON でなければ素のテキストとして続行
    }
  }
  const lines = text.split(/[\n,、]+/);
  const out: SnsEntry[] = [];
  for (const l of lines) {
    const e = parseLine(l);
    if (e) out.push(e);
  }
  return dedupe(out);
}

function dedupe(entries: SnsEntry[]): SnsEntry[] {
  const seen = new Set<string>();
  const out: SnsEntry[] = [];
  for (const e of entries) {
    const key = `${e.platform}:${e.handle.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

// 構造化した SnsEntry[] を contacts.sns に保存する 1 行 1 件のテキストへ戻す。
export function serializeSnsEntries(entries: SnsEntry[]): string {
  return dedupe(entries)
    .map((e) => (e.url ? e.url : `${e.platform}: ${e.handle}`))
    .join("\n");
}

// ------- 本人と思われる SNS の候補 (未確認) の抽出 -------
// 公開検索の結果 URL から「プロフィールページの形」をした URL だけを決定的に拾う
// (AI 不要)。あくまで候補 = 未確認。承認/削除は必ずユーザーが行う (最終判断はユーザー)。

// 投稿・動画など「プロフィールでない」パス。候補にしない。
const NON_PROFILE_PATH = /\/(status|statuses|posts|p|reel|reels|watch|video|videos|hashtag|search|share|events|groups|photo|photos|notes?\/n)\//i;

/**
 * 検索結果からプロフィール URL の候補を抽出する。既存の登録 (existing)・既知の候補と
 * 重ならないものだけ。プラットフォームごとに最初の 1 件 (乱立させない)。
 */
export function extractSnsCandidates(
  results: Array<{ url: string; title?: string }>,
  existing: SnsEntry[],
  max = 4,
): SnsEntry[] {
  const known = new Set(existing.map((e) => `${e.platform}:${e.handle.toLowerCase()}`));
  const seenPlatform = new Set(existing.map((e) => e.platform));
  const out: SnsEntry[] = [];
  for (const r of results) {
    if (out.length >= max) break;
    let u: URL;
    try {
      u = new URL(r.url);
    } catch {
      continue;
    }
    const platform = platformFromHost(u.hostname.toLowerCase());
    if (platform === "blog") continue; // 一般サイトは本人性の推定が難しいので候補にしない
    if (NON_PROFILE_PATH.test(u.pathname)) continue;
    // プロフィールの形: /handle または /in/handle (LinkedIn)。深い階層は投稿の可能性が高い
    const segs = u.pathname.split("/").filter(Boolean);
    const profileShaped =
      segs.length === 1 || (platform === "linkedin" && segs.length === 2 && segs[0] === "in") || (platform === "youtube" && segs.length === 1);
    if (!profileShaped) continue;
    const handle = (platform === "linkedin" ? segs[1]! : segs[0]!).replace(/^@/, "");
    if (!handle || handle.length > 60) continue;
    const key = `${platform}:${handle.toLowerCase()}`;
    if (known.has(key) || seenPlatform.has(platform)) continue; // 既に登録/候補のある場は増やさない
    known.add(key);
    seenPlatform.add(platform);
    out.push({ platform, handle, url: r.url });
  }
  return out;
}

/** 候補 (JSON 文字列) の読み書き。壊れていれば空。 */
export function parseSnsCandidates(raw: string | null | undefined): SnsEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is SnsEntry => !!x && typeof x === "object" && typeof (x as SnsEntry).platform === "string")
      .slice(0, 8);
  } catch {
    return [];
  }
}

// 相手の近況を公開情報から把握するための検索クエリ。氏名を軸に、記録済みの
// SNS ハンドルを添えて別人 (同姓同名) を拾いにくくする。直近を優先。
export function snsSearchQueries(name: string, entries: SnsEntry[], company?: string | null): string[] {
  const queries: string[] = [];
  const co = (company ?? "").trim();
  for (const e of entries.slice(0, 3)) {
    // ハンドルは強い識別子。プラットフォーム名と一緒に近況を探す
    queries.push(`${name} ${e.handle} ${snsPlatformLabel(e.platform)} 最近`);
  }
  if (queries.length === 0) {
    queries.push(co ? `${name} ${co} 最近 近況` : `${name} 最近 近況 SNS`);
  }
  return queries.slice(0, 3);
}
