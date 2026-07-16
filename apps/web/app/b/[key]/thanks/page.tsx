"use client";
// お支払い後の戻り先。決済の確認 (サーバ側で Stripe に照合 = BMP-LP と同じ検証) を行い、
// 確定できたことをお伝えする。確認が遅れても毎時の再照合が拾うため、その旨も添える。
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ThanksBody() {
  const { key } = useParams<{ key: string }>();
  const search = useSearchParams();
  const sessionId = search.get("session_id") ?? "";
  const [status, setStatus] = useState<"checking" | "confirmed" | "pending" | "unknown">("checking");

  useEffect(() => {
    let tries = 0;
    let stopped = false;
    const check = async () => {
      const res = await fetch(
        `/api/bff/public/offers/${key}/booking-status?session_id=${encodeURIComponent(sessionId)}`,
      );
      if (stopped) return;
      if (!res.ok) {
        setStatus("unknown");
        return;
      }
      const body = (await res.json()) as { status: string };
      if (body.status === "confirmed") {
        setStatus("confirmed");
        return;
      }
      tries += 1;
      if (tries < 5) setTimeout(() => void check(), 3000);
      else setStatus("pending");
    };
    if (sessionId) void check();
    else setStatus("unknown");
    return () => {
      stopped = true;
    };
  }, [key, sessionId]);

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
      <h1 style={{ fontSize: 22 }}>お申し込みありがとうございます</h1>
      {status === "checking" && <p style={{ lineHeight: 1.9 }}>お支払いを確認しています。そのままお待ちください…</p>}
      {status === "confirmed" && (
        <div style={{ marginTop: 16, padding: "20px 16px", background: "#f0fdf4", borderRadius: 12 }}>
          <p style={{ margin: 0, lineHeight: 1.9 }}>
            お支払いを確認し、ご予約が確定しました。当日の進め方は、いただいた連絡先へあらためてお知らせします。
          </p>
        </div>
      )}
      {status === "pending" && (
        <p style={{ lineHeight: 1.9 }}>
          お支払いの確認に少し時間がかかっています。確認できしだい自動でご予約が確定しますので、
          このままお待ちいただいて大丈夫です。ご心配な場合は、リンクを送ってくれた方にご連絡ください。
        </p>
      )}
      {status === "unknown" && (
        <p style={{ lineHeight: 1.9 }}>このページを直接開くことはできません。予約のページからやり直してください。</p>
      )}
    </main>
  );
}

export default function BookingThanksPage() {
  return (
    <Suspense fallback={<main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}><p>読み込んでいます…</p></main>}>
      <ThanksBody />
    </Suspense>
  );
}
