"use client";
// サインイン状態の表示 (ダッシュボード上部)。Firebase 未設定なら何も出さない。
import { useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "firebase/auth";
import { firebaseConfigured, watchUser, signOutUser } from "../lib/firebase";
import { t } from "../lib/i18n";

export function AuthBar() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return watchUser((u) => {
      setUser(u);
      setReady(true);
    });
  }, []);

  if (!firebaseConfigured() || !ready) return null;
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, color: "#64748b", fontSize: 14 }}>
      {user ? (
        <>
          <span>{user.displayName ?? user.email}{t("x_user_honorific")}</span>
          <button
            onClick={() => void signOutUser().then(() => location.reload())}
            style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}
          >
            {t("sign_out")}
          </button>
        </>
      ) : (
        <Link href="/login" style={{ color: "#2563eb" }}>{t("sign_in")}</Link>
      )}
    </div>
  );
}
