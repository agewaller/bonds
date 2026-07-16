"use client";
// すべての項目 (パネル) を折りたたみ可能にする共通部品。
// 見出しをそのままボタンにして、どのパネルもワンタップでたためる。開閉の状態は
// この端末に記憶する (中身のデータは何も保存しない = PII をブラウザに置かない原則のまま)。
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

const KEY = "bonds_fold_v1";

function readAll(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export default function Fold({
  k,
  title,
  defaultOpen = true,
  style,
  children,
}: {
  k: string; // 記憶用の安定キー (画面内で一意)
  title: ReactNode;
  defaultOpen?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // 記憶した開閉を初回に反映 (SSR とずれないよう effect で)
  useEffect(() => {
    const v = readAll()[k];
    if (typeof v === "boolean") setOpen(v);
  }, [k]);
  const toggle = () =>
    setOpen((prev) => {
      const next = !prev;
      try {
        const all = readAll();
        all[k] = next;
        window.localStorage.setItem(KEY, JSON.stringify(all));
      } catch {
        // 記憶できない環境でも開閉そのものは効く
      }
      return next;
    });
  return (
    <section style={style}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          background: "transparent",
          border: "none",
          padding: 0,
          margin: 0,
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 600 }}>{title}</span>
        <span style={{ color: "#94a3b8", fontSize: 12, flexShrink: 0 }}>{open ? "たたむ" : "ひらく"}</span>
      </button>
      {open && <div style={{ marginTop: 6 }}>{children}</div>}
    </section>
  );
}
