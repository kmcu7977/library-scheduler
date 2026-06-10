import { useState } from "react";
import SubTooltip from "./SubTooltip";

export default function ScheduleCell({ name, day, si, fk, members, schedule, onClick, active, timeSlots, colSpan, onHoverMember, dim, pinned }) {
  const [hovered, setHovered] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const color = members.find(m => m.name === name)?.color || "#aaa";
  const baseStyle = name ? { background: color + "28", color, fontWeight: 700 } : {};
  const dimStyle  = dim ? { background: "rgba(0,0,0,0.08)", color: "#b0bec5", fontWeight: 400 } : {};
  const pinStyle  = pinned ? { boxShadow: "inset 0 0 0 2px #f9a825" } : {};
  return (
    <td
      colSpan={colSpan || 1}
      className={`td-cell ${active ? "active-cell" : ""} ${!name ? "empty-cell" : ""}`}
      style={{ ...baseStyle, ...dimStyle, ...pinStyle }}
      title={pinned ? "고정된 칸 (재배치해도 유지)" : undefined}
      onClick={() => { setHovered(false); onClick(); }}
      onMouseEnter={e => {
        if (name) { setMousePos({ x: e.clientX, y: e.clientY }); setHovered(true); onHoverMember?.(name); }
      }}
      onMouseMove={e => { if (name) setMousePos({ x: e.clientX, y: e.clientY }); }}
      onMouseLeave={() => { setHovered(false); onHoverMember?.(null); }}
    >
      {pinned && <span style={{ fontSize: 8, marginRight: 2 }}>📌</span>}
      {name || "·"}
      {hovered && name && (
        <SubTooltip members={members} day={day} si={si} fk={fk}
          schedule={schedule} mousePos={mousePos} visible={hovered} timeSlots={timeSlots} />
      )}
    </td>
  );
}
