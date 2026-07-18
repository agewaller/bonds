"use client";
// timeshare の空き時間カレンダーの踏襲 — 同じ FullCalendar の現行版 (v6・公式 React 対応)。
// カレンダーをドラッグしてなぞると空き枠 (この日はここが空いている) になり、
// 枠をタップすると消せる。なぞった日はその枠がそのまま空きになり、
// なぞっていない日は曜日別の受付時間が使われる (日単位の優先)。
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import jaLocale from "@fullcalendar/core/locales/ja";

export type AvailabilitySlotRow = { id: string; start: string; end: string };
export type BusyInterval = { start: string; end: string };

export default function AvailabilityCalendar({
  slots,
  busy = [],
  onCreate,
  onDelete,
}: {
  slots: AvailabilitySlotRow[];
  busy?: BusyInterval[];
  onCreate: (startIso: string, endIso: string) => void;
  onDelete: (id: string) => void;
}) {
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  return (
    // 7 列がモバイル幅で潰れて曜日ヘッダの文字が重なるため、横スクロール可 + 最小幅を確保する。
    <div className="bonds-fc" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ minWidth: 680 }}>
      <FullCalendar
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        locale={jaLocale}
        headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
        height="auto"
        allDaySlot={false}
        slotDuration="00:30:00"
        snapDuration="00:30:00"
        slotMinTime="06:00:00"
        slotMaxTime="24:00:00"
        nowIndicator
        selectable
        selectMirror
        longPressDelay={250}
        validRange={{ start: new Date() }}
        // 日付と曜日を 2 段に分けて表示 (1 行だと狭い列で重なる)
        dayHeaderContent={(arg) => (
          <div style={{ lineHeight: 1.2, fontSize: 12, fontWeight: 600 }}>
            <div>{arg.date.getMonth() + 1}/{arg.date.getDate()}</div>
            <div style={{ color: "#64748b", fontWeight: 400 }}>({WD[arg.date.getDay()]})</div>
          </div>
        )}
        select={(info) => {
          onCreate(info.start.toISOString(), info.end.toISOString());
        }}
        events={[
          // 取り込んだ予定 (Google / Outlook 等) は背景色で「予定あり」を示す。
          // 予定の中身は持たないので件名は出さない。ここ以外の白い時間が空き。
          ...busy.map((b, i) => ({
            id: `busy-${i}`,
            start: b.start,
            end: b.end,
            display: "background" as const,
            backgroundColor: "#94a3b8", // 取り込んだ予定 (予定あり) をはっきり見せる
          })),
          // ドラッグで登録した空き枠 (緑・タップで削除)
          ...slots.map((s) => ({
            id: s.id,
            start: s.start,
            end: s.end,
            title: "空き (タップで消す)",
            backgroundColor: "#16a34a",
            borderColor: "#15803d",
          })),
        ]}
        eventClick={(info) => {
          if (info.event.id.startsWith("busy-")) return; // 取り込んだ予定は消せない
          onDelete(info.event.id);
        }}
      />
      </div>
    </div>
  );
}
