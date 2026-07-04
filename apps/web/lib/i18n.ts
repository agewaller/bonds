"use client";
// UI 文言の辞書 (cares FN-I18N-01 の縮約版)。既定は日本語 (65 歳ペルソナ)。
// 新規のユーザー向け文言はハードコードせずこの辞書経由にする (CLAUDE.md)。
// 言語の源泉: cookie `bonds_locale` (未ログインでも保持)。en 未訳キーは ja へフォールバック。

export const LOCALES = ["ja", "en"] as const;
export type Locale = (typeof LOCALES)[number];

const DICT: Record<string, Partial<Record<Locale, string>>> = {
  app_tagline: {
    ja: "人とのつながりを育てるための道具です。",
    en: "A tool for growing your relationships.",
  },
  open_contacts: { ja: "連絡帳をひらく", en: "Open contacts" },
  start_person_eval: { ja: "人物評価をはじめる", en: "Evaluate a public figure" },
  contacts_title: { ja: "連絡帳", en: "Contacts" },
  back_home: { ja: "ホームへ戻る", en: "Back to home" },
  connection_score: { ja: "つながりスコア", en: "Connection score" },
  today_suggestion: { ja: "今日、連絡してみませんか", en: "How about reaching out today?" },
  contacted: { ja: "連絡しました", en: "Done" },
  add_section: { ja: "追加する", en: "Add" },
  name_placeholder: { ja: "お名前", en: "Name" },
  add_button: { ja: "追加", en: "Add" },
  everyone: { ja: "みなさん", en: "Everyone" },
  login_tagline: {
    ja: "大切な人とのつながりを、ここから育てましょう。",
    en: "Grow the bonds with people who matter, starting here.",
  },
  login_google: { ja: "Google ではじめる", en: "Continue with Google" },
  sign_in: { ja: "サインイン", en: "Sign in" },
  sign_out: { ja: "サインアウト", en: "Sign out" },
};

export function normalizeUiLocale(v: string | null | undefined): Locale {
  return v === "en" ? "en" : "ja";
}

export function currentLocale(): Locale {
  if (typeof document === "undefined") return "ja";
  const m = document.cookie.match(/(?:^|; )bonds_locale=([^;]+)/);
  return normalizeUiLocale(m?.[1]);
}

export function setLocale(locale: Locale): void {
  document.cookie = `bonds_locale=${locale}; path=/; max-age=31536000; samesite=lax`;
}

/** 辞書引き。未訳は ja へフォールバック、キー未登録はキー名をそのまま返す (取り漏れ検知)。 */
export function t(key: string, locale?: Locale): string {
  const loc = locale ?? currentLocale();
  const entry = DICT[key];
  if (!entry) return key;
  return entry[loc] ?? entry.ja ?? key;
}
