"use client";
// 日程調整の公開ページのカレンダー — timeshare と同じ FullCalendar の現行版で、
// 空いている開始時刻を色つきのマスとして週間グリッドに描く。タップで候補に選ぶ。
// 緑 = みんなに共通の空き、青 = 主催者の空き。期間の外は選べない (グレー表示)。
import { useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import jaLocale from "@fullcalendar/core/locales/ja";

export type IsoSlot = { start: string; end: string };

const GRID_MINUTES = 30;

export default function ShareSlotCalendar({
  options,
  chosen,
  onToggle,
  common,
  maxChoices = 1,
}: {
  options: IsoSlot[];
  chosen: string[];
  onToggle: (startIso: string) => void;
  common: boolean;
  maxChoices?: number;
}) {
  const { events, initialDate, slotMinTime, slotMaxTime, validRange } = useMemo(() => {
    let minMin = 24 * 60;
    let maxMin = 0;
    let firstDay: Date | null = null;
    let lastDay: Date | null = null;
    const evts = options.map((o) => {
      const d = new Date(o.start);
      const minutes = d.getHours() * 60 + d.getMinutes();
      minMin = Math.min(minMin, minutes);
      maxMin = Math.max(maxMin, minutes + GRID_MINUTES);
      if (!firstDay || d < firstDay) firstDay = d;
      if (!lastDay || d > lastDay) lastDay = d;
      const on = chosen.includes(o.start);
      return {
        id: o.start,
        start: o.start,
        // マスは常に 30 分グリッド 1 コマで敷き詰める (面談時間ぶん重ねると読めなくなる)
        end: new Date(d.getTime() + GRID_MINUTES * 60 * 1000).toISOString(),
        title: `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`,
        backgroundColor: on ? "#2563eb" : common ? "#bbf7d0" : "#bfdbfe",
        borderColor: on ? "#1d4ed8" : common ? "#86efac" : "#93c5fd",
        textColor: on ? "#ffffff" : "#1e3a5f",
      };
    });
    const floor = Math.floor(Math.max(0, minMin - GRID_MINUTES) / 60) * 60;
    const ceil = Math.min(24 * 60, Math.ceil((maxMin + GRID_MINUTES) / 60) * 60);
    const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
    const dayStart = firstDay
      ? new Date((firstDay as Date).getFullYear(), (firstDay as Date).getMonth(), (firstDay as Date).getDate())
      : new Date();
    const dayEnd = lastDay
      ? new Date((lastDay as Date).getFullYear(), (lastDay as Date).getMonth(), (lastDay as Date).getDate() + 1)
      : new Date();
    return {
      events: evts,
      initialDate: dayStart,
      slotMinTime: options.length ? toTime(floor) : "09:00:00",
      slotMaxTime: options.length ? toTime(ceil) : "18:00:00",
      validRange: { start: dayStart, end: dayEnd },
    };
  }, [options, chosen, common]);

  if (options.length === 0) return null;

  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  return (
    // モバイル幅で 7 列が潰れるため、横スクロール可 + 最小幅を確保する。
    <div className="bonds-fc" style={{ marginTop: 12, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ minWidth: 680 }}>
      <FullCalendar
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        initialDate={initialDate}
        locale={jaLocale}
        headerToolbar={{ left: "prev,next", center: "title", right: "" }}
        height="auto"
        allDaySlot={false}
        slotDuration="00:30:00"
        slotMinTime={slotMinTime}
        slotMaxTime={slotMaxTime}
        validRange={validRange}
        displayEventTime={false}
        dayHeaderContent={(arg) => (
          <div style={{ lineHeight: 1.2, fontSize: 12, fontWeight: 600 }}>
            <div>{arg.date.getMonth() + 1}/{arg.date.getDate()}</div>
            <div style={{ color: "#64748b", fontWeight: 400 }}>({WD[arg.date.getDay()]})</div>
          </div>
        )}
        events={events}
        eventClick={(info) => {
          const startIso = info.event.id;
          if (!chosen.includes(startIso) && chosen.length >= maxChoices) return;
          onToggle(startIso);
        }}
      />
      </div>
    </div>
  );
}
