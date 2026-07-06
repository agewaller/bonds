// 人物DD の search ステップ用 Web 検索 (Tavily)。vm-suite の検索ゲートウェイ相当。
// TAVILY_API_KEY が無ければ null (ランナーは従来どおり知識ベースモードで skip)。
// テストでは SearchFn を注入して実 API は呼ばない。

export type SearchResult = { title: string; url: string; snippet: string };
export type SearchFn = (query: string) => Promise<SearchResult[]>;

export function buildTavilySearch(): SearchFn | null {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;
  return async (query: string) => {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 5,
        search_depth: "basic",
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`tavily_error: ${res.status}`);
    const body = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (body.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url!,
        snippet: (r.content ?? "").slice(0, 500),
      }));
  };
}

/** 人物 DD 用の定型クエリ (一次/実績/批判を分けて集める = vm の search_catalog の精神)。 */
export function personSearchQueries(name: string): string[] {
  return [`${name}`, `${name} 経歴 実績`, `${name} 批判 問題点`];
}

/** 検索結果を evaluate へ渡す参考情報ダイジェストにする。出典 URL を必ず添える。 */
export function buildSearchDigest(results: Array<{ query: string; items: SearchResult[] }>): string {
  const lines: string[] = [
    "参考情報 (Web 検索の抜粋。事実かどうかの確からしさは自分で判定し、evidence の certainty に反映すること):",
  ];
  for (const r of results) {
    for (const item of r.items.slice(0, 3)) {
      lines.push(`出典 ${item.url} : ${item.title} ${item.snippet.slice(0, 300)}`);
    }
  }
  return lines.length > 1 ? lines.join("\n") : "";
}
