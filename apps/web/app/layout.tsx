import type { ReactNode } from "react";
import { ServiceWorkerRegister } from "./sw-register";

export const metadata = {
  title: "bonds",
  description: "人物デューデリジェンス + 関係性マネジメント",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "bonds" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport = {
  themeColor: "#2563eb",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
