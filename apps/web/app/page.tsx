// ランディング。フェーズ1: 人物評価へ誘導。フェーズ2 以降で連絡帳を載せる。
import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 16px" }}>
      <h1>bonds</h1>
      <p>人とのつながりを育てるための道具です。</p>
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
          連絡帳をひらく
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
          人物評価をはじめる
        </Link>
      </p>
    </main>
  );
}
