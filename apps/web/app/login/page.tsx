"use client";
// サインイン — cares と同じ Firebase Auth (Google)。
// Firebase 未設定のローカル開発ではその旨を案内する (BFF フォールバックで連絡帳は動く)。
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { firebaseConfigured, signInWithGoogle, watchUser } from "../../lib/firebase";

export default function LoginPage() {
  const router = useRouter();
  const [configured] = useState(firebaseConfigured());
  const [error, setError] = useState("");

  useEffect(() => {
    return watchUser((user) => {
      if (user) router.replace("/contacts");
    });
  }, [router]);

  const login = async () => {
    setError("");
    try {
      await signInWithGoogle();
      router.replace("/contacts");
    } catch {
      setError("サインインできませんでした。もう一度お試しください");
    }
  };

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "64px 16px", textAlign: "center" }}>
      <h1>bonds</h1>
      <p>大切な人とのつながりを、ここから育てましょう。</p>
      {configured ? (
        <button
          onClick={() => void login()}
          style={{
            padding: "12px 32px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          Google ではじめる
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
