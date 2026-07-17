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

export default function AvailabilityCalendar({
  slots,
  onCreate,
  onDelete,
}: {
  slots: AvailabilitySlotRow[];
  onCreate: (startIso: string, endIso: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bonds-fc">
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
        select={(info) => {
          onCreate(info.start.toISOString(), info.end.toISOString());
        }}
        events={slots.map((s) => ({
          id: s.id,
          start: s.start,
          end: s.end,
          title: "空き (タップで消す)",
          backgroundColor: "#16a34a",
          borderColor: "#15803d",
        }))}
        eventClick={(info) => {
          onDelete(info.event.id);
        }}
      />
    </div>
  );
}
