"use client";
// UI 文言の辞書 (cares FN-I18N-01 の縮約版)。既定は日本語 (65 歳ペルソナ)。
// 新規のユーザー向け文言はハードコードせずこの辞書経由にする (CLAUDE.md)。
// 言語の源泉: cookie `bonds_locale` (未ログインでも保持)。en 未訳キーは ja へフォールバック。

export const LOCALES = ["ja", "en"] as const;
export type Locale = (typeof LOCALES)[number];

import { DICT_CONTACTS } from "./i18n-dict-contacts";
import { DICT_SUBJECTS } from "./i18n-dict-subjects";
import { DICT_SECTIONS } from "./i18n-dict-sections";
import { DICT_MISC } from "./i18n-dict-misc";

export type DictEntry = Partial<Record<Locale, string>>;

const DICT: Record<string, DictEntry> = {
  app_tagline: {
    ja: "人とのつながりを育てるための道具です。",
    en: "A tool for growing your relationships.",
  },
  open_contacts: { ja: "連絡帳をひらく", en: "Open contacts" },
  start_person_eval: { ja: "人物評価をはじめる", en: "Evaluate a public figure" },
  home_contacts: { ja: "連絡先", en: "Contacts" },
  home_contacts_desc: {
    ja: "大切な方々との関係を育てます。取り込み・今日のおすすめ・お便りもここから。",
    en: "Grow your relationships. Imports, daily suggestions and letters live here.",
  },
  home_offerings: { ja: "モノやサービスの提供", en: "Things and services you offer" },
  home_offerings_desc: {
    ja: "譲れるもの・教えられること・相談にのれることを載せて、必要な方に届けます。",
    en: "List what you can give, teach or help with, and reach the people who need it.",
  },
  home_schedule: { ja: "時間調整と時間販売", en: "Scheduling and selling your time" },
  home_schedule_desc: {
    ja: "空き時間を見せて日程を決める共有ページと、時間の出品・予約の受け付け。",
    en: "Share your availability to settle dates, and take bookings for your time.",
  },
  home_subjects: { ja: "人物評価", en: "Person evaluation" },
  home_subjects_desc: {
    ja: "公人を二つの視点（意識の七次元・社会価値創造）で評価します。",
    en: "Evaluate public figures from two perspectives.",
  },
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
  // 画面別の辞書 (肥大化を避けるためファイル分割。キー衝突は後勝ちなので接頭辞で避ける)
  ...DICT_CONTACTS,
  ...DICT_SUBJECTS,
  ...DICT_SECTIONS,
  ...DICT_MISC,
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
