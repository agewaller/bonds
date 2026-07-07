"use client";
// 提携先ディレクトリ (公開)。掲載を許可した提携先だけを表示する (ADR-0022 移植)。
import { useEffect, useState } from "react";
import Link from "next/link";

type Partner = { kind: string; name: string; url: string | null; blurb: string | null };

const KIND_LABEL: Record<string, string> = {
  site: "メディア・サイト",
  sns: "SNS",
  association: "団体・協会",
  community: "コミュニティ",
  service: "サービス",
  corp: "企業",
  other: "その他",
};

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/bff/partners");
      setPartners(res.ok ? (await res.json()).partners : []);
    })();
  }, []);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <p>
        <Link href="/" style={{ color: "#2563eb" }}>
          ホームへ戻る
        </Link>
      </p>
      <h1 style={{ fontSize: 24 }}>提携先のご紹介</h1>
      <p style={{ color: "#64748b" }}>bonds と一緒に、人のつながりを支えてくださっている皆さまです。</p>
      {partners === null && <p style={{ color: "#64748b" }}>読み込んでいます…</p>}
      {partners !== null && partners.length === 0 && (
        <p style={{ color: "#64748b" }}>提携先は準備中です。もうしばらくお待ちください。</p>
      )}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {(partners ?? []).map((p, i) => (
          <li key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontWeight: 600 }}>
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "none" }}>
                    {p.name}
                  </a>
                ) : (
                  p.name
                )}
              </span>
              <small style={{ color: "#64748b", whiteSpace: "nowrap" }}>{KIND_LABEL[p.kind] ?? ""}</small>
            </div>
            {p.blurb && <p style={{ margin: "6px 0 0", color: "#334155", fontSize: 14 }}>{p.blurb}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
