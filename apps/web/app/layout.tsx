import type { ReactNode } from "react";

export const metadata = {
  title: "bonds",
  description: "人物デューデリジェンス + 関係性マネジメント",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
