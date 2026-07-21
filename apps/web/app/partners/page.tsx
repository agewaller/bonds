"use client";
// 提携先ディレクトリ (公開)。掲載を許可した提携先だけを表示する (ADR-0022 移植)。
import { useEffect, useState } from "react";
import Link from "next/link";
import { safeExternalUrl } from "../../lib/safe-url";
import { t, currentLocale, type Locale } from "../../lib/i18n";

type Partner = { kind: string; name: string; url: string | null; blurb: string | null };

const KIND_KEY: Record<string, string> = {
  site: "m_prt_kind_site",
  association: "m_prt_kind_association",
  community: "m_prt_kind_community",
  service: "m_prt_kind_service",
  corp: "m_prt_kind_corp",
  other: "m_prt_kind_other",
};

export default function PartnersPage() {
  // cookie はクライアントでしか読めないため、初回描画後に反映する
  const [locale, setLoc] = useState<Locale>("ja");
  useEffect(() => setLoc(currentLocale()), []);
  const T = (key: string) => t(key, locale);
  const [partners, setPartners] = useState<Partner[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/bff/partners");
      setPartners(res.ok ? (await res.json()).partners : []);
    })();
  }, []);

  // "SNS" は日本語・英語とも同じ表記のため辞書を通さない
  const kindLabel = (kind: string) => (kind === "sns" ? "SNS" : KIND_KEY[kind] ? T(KIND_KEY[kind]!) : "");

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <p>
        <Link href="/" style={{ color: "#2563eb" }}>
          {T("back_home")}
        </Link>
      </p>
      <h1 style={{ fontSize: 24 }}>{T("m_prt_title")}</h1>
      <p style={{ color: "#64748b" }}>{T("m_prt_intro")}</p>
      {partners === null && <p style={{ color: "#64748b" }}>{T("m_loading")}</p>}
      {partners !== null && partners.length === 0 && (
        <p style={{ color: "#64748b" }}>{T("m_prt_empty")}</p>
      )}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {(partners ?? []).map((p, i) => (
          <li key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontWeight: 600 }}>
                {safeExternalUrl(p.url) ? (
                  <a href={safeExternalUrl(p.url)!} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "none" }}>
                    {p.name}
                  </a>
                ) : (
                  p.name
                )}
              </span>
              <small style={{ color: "#64748b", whiteSpace: "nowrap" }}>{kindLabel(p.kind)}</small>
            </div>
            {p.blurb && <p style={{ margin: "6px 0 0", color: "#334155", fontSize: 14 }}>{p.blurb}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
