"use client";
// お支払い後の戻り先。決済の確認 (サーバ側で Stripe に照合 = BMP-LP と同じ検証) を行い、
// 確定できたことをお伝えする。確認が遅れても毎時の再照合が拾うため、その旨も添える。
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { t, currentLocale, type Locale } from "../../../../lib/i18n";

function ThanksBody() {
  // cookie はクライアントでしか読めないため、初回描画後に反映する
  const [locale, setLoc] = useState<Locale>("ja");
  useEffect(() => setLoc(currentLocale()), []);
  const T = (key: string) => t(key, locale);
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
      <h1 style={{ fontSize: 22 }}>{T("m_th_title")}</h1>
      {status === "checking" && <p style={{ lineHeight: 1.9 }}>{T("m_th_checking")}</p>}
      {status === "confirmed" && (
        <div style={{ marginTop: 16, padding: "20px 16px", background: "#f0fdf4", borderRadius: 12 }}>
          <p style={{ margin: 0, lineHeight: 1.9 }}>
            {T("m_th_confirmed")}
          </p>
        </div>
      )}
      {status === "pending" && (
        <p style={{ lineHeight: 1.9 }}>
          {T("m_th_pending")}
        </p>
      )}
      {status === "unknown" && (
        <p style={{ lineHeight: 1.9 }}>{T("m_th_unknown")}</p>
      )}
    </main>
  );
}

export default function BookingThanksPage() {
  // cookie はクライアントでしか読めないため、初回描画後に反映する
  const [locale, setLoc] = useState<Locale>("ja");
  useEffect(() => setLoc(currentLocale()), []);
  return (
    <Suspense fallback={<main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}><p>{t("m_loading", locale)}</p></main>}>
      <ThanksBody />
    </Suspense>
  );
}
