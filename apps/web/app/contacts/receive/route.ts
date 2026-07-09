// Web Share Target の受け口。スマホで SNS のダウンロードデータ (ZIP/CSV 等) を
// 「共有」→ bonds に送ると、ここが multipart を受けて取り込みジョブに預け、
// 連絡帳へ戻す。ブラウザは API を直接叩かず、管理トークンはこのサーバ側だけに置く
// (BFF と同じ原則)。Android 等の共有ターゲット対応ブラウザで有効
// (iOS Safari は Web Share Target 非対応のため、その場合は従来のファイル選択/貼り付けで取り込む)。
import { NextResponse, type NextRequest } from "next/server";

const API_BASE = process.env.INTERNAL_API_URL ?? "http://localhost:8080";

// import-jobs に一件預ける (uploadFiles と同じ octet-stream 経路)。管理トークンで owner スコープ。
async function enqueueBytes(bytes: ArrayBuffer, filename: string): Promise<boolean> {
  const url = new URL(`/api/contacts/import-jobs?filename=${encodeURIComponent(filename)}`, API_BASE);
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken) headers["x-admin-token"] = adminToken;
  const res = await fetch(url, { method: "POST", headers, body: bytes, cache: "no-store" });
  return res.ok;
}

async function enqueueText(content: string): Promise<boolean> {
  const url = new URL("/api/contacts/import-jobs", API_BASE);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken) headers["x-admin-token"] = adminToken;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ content }), cache: "no-store" });
  return res.ok;
}

const MEDIA_SKIP = /\.(jpe?g|png|gif|heic|heif|webp|mp4|mov|avi|mp3|m4a|wav|zip|exe|dmg)$/i;
// 注: 画像は import-file 側で読み取れるが、ここでは取込ジョブに素通しする。ZIP は
// import-file が中身を展開するので通す (MEDIA_SKIP から zip は除外して扱う)。

export async function POST(req: NextRequest): Promise<Response> {
  const origin = req.nextUrl.origin;
  const back = (params: string) => NextResponse.redirect(new URL(`/contacts?${params}`, origin), 303);
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    let queued = 0;
    for (const file of files.slice(0, 30)) {
      // 画像/動画/音声以外を取込ジョブへ (ZIP は展開対象なので通す)
      const name = file.name || "shared";
      if (MEDIA_SKIP.test(name) && !/\.zip$/i.test(name)) continue;
      try {
        if (await enqueueBytes(await file.arrayBuffer(), name)) queued++;
      } catch {
        // 一件の失敗で全体を止めない
      }
    }
    // ファイルが無く、テキスト (貼り付け共有: vCard 等) だけのとき
    if (files.length === 0) {
      const text = (form.get("text") ?? form.get("url") ?? "").toString().trim();
      if (text && (await enqueueText(text))) queued++;
    }
    return back(queued > 0 ? `shared=${queued}` : "shared=0");
  } catch {
    return back("shared=0");
  }
}

// 共有ではなく直接 URL を開かれたとき (GET) は連絡帳へ戻す。
export async function GET(req: NextRequest): Promise<Response> {
  return NextResponse.redirect(new URL("/contacts", req.nextUrl.origin), 303);
}
