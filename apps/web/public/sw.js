// 最小限の Service Worker。PWA としてインストール可能にするために置く
// (共有ターゲットの受け口 /contacts/receive はサーバ側ルートが処理するため、
// ここでフェッチを横取りする必要はない)。オフライン化は将来の課題。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // 既定のネットワーク挙動に任せる (横取りしない)。
});
