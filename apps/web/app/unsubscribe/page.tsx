"use client";
// 配信停止 (公開・未認証)。メールのフッタのリンクから ?t=<token> で開かれる。
// API の公開エンドポイント (HMAC 署名トークン) を叩き、以後の配信を止める。
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function Unsubscribe() {
  const params = useSearchParams();
  const token = params.get("t");
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    if (!token) {
      setState("error");
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/bff/public/unsubscribe/${encodeURIComponent(token)}`);
        setState(res.ok ? "done" : "error");
      } catch {
        setState("error");
      }
    })();
  }, [token]);

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "60px 20px", textAlign: "center" }}>
      <h1 style={{ fontSize: 22 }}>配信の停止</h1>
      {state === "loading" && <p style={{ color: "#64748b" }}>手続きしています…</p>}
      {state === "done" && (
        <p style={{ color: "#166534", lineHeight: 1.9 }}>
          配信を停止しました。今後、このメールアドレスへお便りをお送りすることはありません。
          <br />
          ご確認いただきありがとうございました。
        </p>
      )}
      {state === "error" && (
        <p style={{ color: "#b91c1c", lineHeight: 1.9 }}>
          手続きできませんでした。リンクが正しくないか、期限が切れている可能性があります。
          お手数ですが、受け取ったメールにそのままご返信ください。
        </p>
      )}
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<main style={{ padding: 60, textAlign: "center", color: "#64748b" }}>読み込み中…</main>}>
      <Unsubscribe />
    </Suspense>
  );
}
