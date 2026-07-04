"use client";
// どの画面からも言語を切り替えられるセレクタ (cares 🌐 LanguageSelector 相当)。
import { useEffect, useState } from "react";
import { currentLocale, setLocale, type Locale } from "../lib/i18n";

export function LanguageSelector() {
  const [locale, setLoc] = useState<Locale>("ja");
  useEffect(() => setLoc(currentLocale()), []);
  return (
    <select
      aria-label="Language"
      value={locale}
      onChange={(e) => {
        setLocale(e.target.value as Locale);
        location.reload();
      }}
      style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "4px 8px", color: "#64748b" }}
    >
      <option value="ja">日本語</option>
      <option value="en">English</option>
    </select>
  );
}
