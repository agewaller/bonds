"use client";
import { useEffect } from "react";

// Service Worker を登録して bonds をインストール可能な PWA にする
// (ホーム画面のアイコンから開ける・Android では「共有」先に bonds が出る)。
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 登録に失敗しても通常の web としては動くので握りつぶす
    });
  }, []);
  return null;
}
