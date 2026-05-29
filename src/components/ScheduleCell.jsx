import { useState } from "react";
import SubTooltip from "./SubTooltip";

export default function ScheduleCell({ name, day, si, fk, members, schedule, onClick, active, timeSlots, colSpan }) {
  const [hovered, setHovered] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const color = members.find(m => m.name === name)?.color || "#aaa";
  return (
    <td
      colSpan={colSpan || 1}
      className={`td-cell ${active ? "active-cell" : ""} ${!name ? "empty-cell" : ""}`}
      style={name ? { background: color + "28", color, fontWeight: 700 } : {}}
      onClick={() => { setHovered(false); onClick(); }}
      onMouseEnter={e => { if (name) { setMousePos({ x: e.clientX, y: e.clientY }); setHovered(true); } }}
      onMouseMove={e => { if (name) setMousePos({ x: e.clientX, y: e.clientY }); }}
      onMouseLeave={() => setHovered(false)}
    >
      {name || "·"}
      {hovered && name && (
        <SubTooltip members={members} day={day} si={si} fk={fk}
          schedule={schedule} mousePos={mousePos} visible={hovered} timeSlots={timeSlots} />
      )}
    </td>
  );
}
