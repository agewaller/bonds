"use client";
// サインイン — cares と同じ Firebase Auth (Google)。
// Firebase 未設定のローカル開発ではその旨を案内する (BFF フォールバックで連絡帳は動く)。
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  firebaseConfigured,
  signInWithGoogle,
  completeGoogleRedirect,
  watchUser,
  authErrorMessage,
} from "../../lib/firebase";
import { t } from "../../lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const [configured] = useState(firebaseConfigured());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // スマホの画面遷移方式ログインから戻ってきたら、ここで完了処理する。
  // これを呼ばないと redirect ログインが成立扱いにならない (スマホ不具合の根因)。
  // 失敗したら理由を握りつぶさず画面に出す (承認済みドメイン未登録などを切り分けるため)。
  useEffect(() => {
    let active = true;
    void completeGoogleRedirect().then((r) => {
      if (active && r.errorCode) setError(authErrorMessage(r.errorCode));
    });
    const unsub = watchUser((user) => {
      if (user) router.replace("/contacts");
    });
    return () => {
      active = false;
      unsub();
    };
  }, [router]);

  const login = async () => {
    setError("");
    setBusy(true);
    try {
      const done = await signInWithGoogle();
      // popup で成立したときだけ遷移する。redirect のときはページが遷移するので
      // ここには戻らない (戻ってきたら上の completeGoogleRedirect が拾う)。
      if (done) router.replace("/contacts");
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
      setError(code ? authErrorMessage(code) : "サインインできませんでした。もう一度お試しください");
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "64px 16px", textAlign: "center" }}>
      <h1>bonds</h1>
      <p>{t("login_tagline")}</p>
      {configured ? (
        <button
          onClick={() => void login()}
          disabled={busy}
          style={{
            padding: "12px 32px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 16,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "サインインしています…" : t("login_google")}
        </button>
      ) : (
        <p style={{ color: "#64748b" }}>
          サインインの準備がまだ済んでいません (開発中はそのまま
          <Link href="/contacts" style={{ color: "#2563eb" }}> 連絡帳 </Link>
          を使えます)。
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>
          {error}
        </p>
      )}
    </main>
  );
}
