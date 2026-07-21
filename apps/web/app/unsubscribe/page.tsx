"use client";
// 配信停止 (公開・未認証)。メールのフッタのリンクから ?t=<token> で開かれる。
// API の公開エンドポイント (HMAC 署名トークン) を叩き、以後の配信を止める。
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { t, currentLocale, type Locale } from "../../lib/i18n";

function Unsubscribe() {
  // cookie はクライアントでしか読めないため、初回描画後に反映する
  const [locale, setLoc] = useState<Locale>("ja");
  useEffect(() => setLoc(currentLocale()), []);
  const T = (key: string) => t(key, locale);
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
      <h1 style={{ fontSize: 22 }}>{T("m_uns_title")}</h1>
      {state === "loading" && <p style={{ color: "#64748b" }}>{T("m_uns_working")}</p>}
      {state === "done" && (
        <p style={{ color: "#166534", lineHeight: 1.9 }}>
          {T("m_uns_done1")}
          <br />
          {T("m_uns_done2")}
        </p>
      )}
      {state === "error" && (
        <p style={{ color: "#b91c1c", lineHeight: 1.9 }}>
          {T("m_uns_error")}
        </p>
      )}
    </main>
  );
}

export default function UnsubscribePage() {
  // cookie はクライアントでしか読めないため、初回描画後に反映する
  const [locale, setLoc] = useState<Locale>("ja");
  useEffect(() => setLoc(currentLocale()), []);
  return (
    <Suspense fallback={<main style={{ padding: 60, textAlign: "center", color: "#64748b" }}>{t("m_loading_short", locale)}</main>}>
      <Unsubscribe />
    </Suspense>
  );
}
