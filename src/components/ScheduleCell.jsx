import { useState } from "react";
import SubTooltip from "./SubTooltip";

export default function ScheduleCell({ name, day, si, fk, members, schedule, active, timeSlots, colSpan,
  onHoverMember, dim, pinned, selected, dragging, onDragStart, onDragOver, dayStart, lunch }) {
  const [hovered, setHovered] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const color = members.find(m => m.name === name)?.color || "#aaa";
  // 사서 양식 그대로: 칸에는 색을 쓰지 않는다. 사람 구분은 이름 글자와 마우스오버가 한다
  const baseStyle = {};
  const dimStyle  = dim ? { background: "rgba(0,0,0,0.08)", color: "var(--ink-3)", fontWeight: 400 } : {};
  // 확정 칸 표식은 CSS(.pin-cell)가 모서리에 그린다 — 칸 안 글자와 다투지 않게
  // 점심시간 칸은 개인 색을 덮고 고정색으로 — 누가 앉았는지보다 "점심시간"이라는 게 먼저 보여야 한다
  const lunchStyle = lunch ? { background: "#D9E2F3" } : {};
  return (
    <td
      colSpan={colSpan || 1}
      className={`td-cell ${active ? "active-cell" : ""} ${!name ? "empty-cell" : ""} ${selected ? "sel-cell" : ""} ${dayStart ? "day-start" : ""} ${lunch ? "lunch-cell" : ""} ${pinned ? "pin-cell" : ""}`}
      style={{ ...baseStyle, ...lunchStyle, ...dimStyle }}
      title={pinned ? "사서가 확정한 칸입니다. 빈칸 채우기를 해도 유지됩니다" : undefined}
      // 클릭도 드래그도 같은 경로 — 누른 칸에서 뗀 칸까지가 선택 범위가 된다 (한 칸이면 그 칸만)
      onMouseDown={e => { e.preventDefault(); setHovered(false); onDragStart?.(); }}
      onMouseEnter={e => {
        if (dragging) { onDragOver?.(); return; }
        if (name) { setMousePos({ x: e.clientX, y: e.clientY }); setHovered(true); onHoverMember?.(name); }
      }}
      onMouseMove={e => { if (name && !dragging) setMousePos({ x: e.clientX, y: e.clientY }); }}
      onMouseLeave={() => { setHovered(false); onHoverMember?.(null); }}
    >
      {name || "·"}
      {hovered && !dragging && name && (
        <SubTooltip members={members} day={day} si={si} fk={fk}
          schedule={schedule} mousePos={mousePos} visible={hovered} timeSlots={timeSlots} />
      )}
    </td>
  );
}
