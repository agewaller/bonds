"use client";
// ランディング。文言は辞書経由 (lib/i18n)。
import Link from "next/link";
import { useEffect, useState } from "react";
import { t, currentLocale, type Locale } from "../lib/i18n";
import { LanguageSelector } from "../components/LanguageSelector";
import { AuthBar } from "../components/AuthBar";

export default function Home() {
  // cookie はクライアントでしか読めないため、初回描画後に反映する
  const [locale, setLocale] = useState<Locale>("ja");
  useEffect(() => setLocale(currentLocale()), []);
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 16px" }}>
      {/* サインイン/サインアウトの導線 (未ログインなら「サインイン」→/login)。
          登録・ログイン導線は摩擦を減らすため、ホームからも到達できるようにする。 */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 16 }}>
        <AuthBar />
        <LanguageSelector />
      </div>
      <h1>bonds</h1>
      <p>{t("app_tagline", locale)}</p>
      <p style={{ display: "flex", gap: 12 }}>
        <Link
          href="/contacts"
          style={{
            display: "inline-block",
            padding: "12px 24px",
            background: "#2563eb",
            color: "#fff",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          {t("open_contacts", locale)}
        </Link>
        <Link
          href="/subjects"
          style={{
            display: "inline-block",
            padding: "12px 24px",
            border: "1px solid #2563eb",
            color: "#2563eb",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          {t("start_person_eval", locale)}
        </Link>
      </p>
    </main>
  );
}
