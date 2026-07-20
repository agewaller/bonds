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
        <Link href="/settings" style={{ color: "#64748b", fontSize: 14, textDecoration: "none" }}>設定</Link>
        <AuthBar />
        <LanguageSelector />
      </div>
      <h1>bonds</h1>
      <p>{t("app_tagline", locale)}</p>
      {/* 4 つの入り口: 連絡先・モノやサービスの提供・時間調整と時間販売・人物評価 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 14,
          marginTop: 20,
        }}
      >
        {[
          { href: "/contacts", title: t("home_contacts", locale), desc: t("home_contacts_desc", locale), accent: "#2563eb", bg: "#eff6ff" },
          { href: "/market", title: t("home_offerings", locale), desc: t("home_offerings_desc", locale), accent: "#16a34a", bg: "#f0fdf4" },
          { href: "/schedule", title: t("home_schedule", locale), desc: t("home_schedule_desc", locale), accent: "#d97706", bg: "#fffbeb" },
          { href: "/subjects", title: t("home_subjects", locale), desc: t("home_subjects_desc", locale), accent: "#7c3aed", bg: "#faf5ff" },
        ].map((card) => (
          <Link
            key={card.href}
            href={card.href}
            style={{
              display: "block",
              border: `1px solid ${card.accent}33`,
              background: card.bg,
              borderRadius: 12,
              padding: "18px 18px 16px",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span style={{ display: "block", fontSize: 17, fontWeight: 700, color: card.accent }}>{card.title}</span>
            <span style={{ display: "block", marginTop: 6, fontSize: 13, color: "#475569", lineHeight: 1.7 }}>{card.desc}</span>
          </Link>
        ))}
      </div>
      <footer style={{ marginTop: 64, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
        <Link href="/privacy" style={{ color: "#64748b", fontSize: 13, textDecoration: "none" }}>
          プライバシーポリシー
        </Link>
      </footer>
    </main>
  );
}
