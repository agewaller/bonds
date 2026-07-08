// 公開の人物評価ページ (共有リンクの飛び先)。認証不要で誰でも開ける。
// サーバ側で結果を取得して描画し、OG タグも埋めるのでリンクのプレビューにも名前とスコアが出る。
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Section7d, SectionSvc, evalHeadline, type RunSummary } from "../../../components/EvalResult";

type PublicDetail = {
  subject: { name: string; subjectType: string; profileHint: string | null };
  latestByType: Record<string, RunSummary>;
};

const API_BASE = process.env.INTERNAL_API_URL ?? "http://localhost:8080";

async function fetchPublic(slug: string): Promise<PublicDetail | null> {
  try {
    const res = await fetch(`${API_BASE}/api/public/subjects/${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PublicDetail;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const detail = await fetchPublic(slug);
  if (!detail) return { title: "人物評価 — bonds" };
  const headline = evalHeadline(
    detail.subject.name,
    detail.latestByType.consciousness_7d,
    detail.latestByType.social_value_creation,
  );
  const description = "意識の七次元と社会価値創造の二つの視点で公人を評価した結果です。あなたも試せます。";
  return {
    title: `${headline} — bonds`,
    description,
    openGraph: { title: `${headline} — bonds`, description, type: "article" },
    twitter: { card: "summary", title: `${headline} — bonds`, description },
  };
}

export default async function PublicEvalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await fetchPublic(slug);
  if (!detail) notFound();

  const r7d = detail.latestByType.consciousness_7d;
  const rSvc = detail.latestByType.social_value_creation;

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <p style={{ color: "#94a3b8", fontSize: 13, letterSpacing: 1 }}>bonds 人物評価</p>
      <h1 style={{ fontSize: 26, marginBottom: detail.subject.profileHint ? 4 : 16 }}>{detail.subject.name}</h1>
      {detail.subject.profileHint && (
        <p style={{ color: "#64748b", margin: "0 0 16px", fontSize: 14 }}>{detail.subject.profileHint}</p>
      )}

      {r7d?.status === "completed" && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 20, borderBottom: "2px solid #2563eb", paddingBottom: 4 }}>意識の七次元</h2>
          <Section7d run={r7d} />
        </section>
      )}

      {rSvc?.status === "completed" && (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 20, borderBottom: "2px solid #2563eb", paddingBottom: 4 }}>社会価値創造</h2>
          <SectionSvc run={rSvc} />
        </section>
      )}

      {/* 受け取った人も試せるよう誘導する (紹介ループ)。 */}
      <div style={{ marginTop: 40, padding: "20px 16px", background: "#f8fafc", borderRadius: 12, textAlign: "center" }}>
        <p style={{ margin: "0 0 12px", color: "#334155" }}>
          あなたも、気になる公人を同じ視点で評価してみませんか。
        </p>
        <Link
          href="/subjects"
          style={{
            display: "inline-block", padding: "12px 24px", background: "#2563eb", color: "#fff",
            borderRadius: 8, textDecoration: "none", fontWeight: 600,
          }}
        >
          bonds で人物を評価する
        </Link>
      </div>

      <footer style={{ marginTop: 32, color: "#94a3b8", fontSize: 13 }}>
        この評価は公開情報にもとづく参考情報で、断定ではありません。最新の出来事が反映されていない場合があります。
      </footer>
    </main>
  );
}
