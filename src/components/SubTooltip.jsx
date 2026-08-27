import { useState, useEffect, useRef } from "react";
import { FLOOR_LABEL } from "../constants";
import { getAvailableMembers } from "../utils";

export default function SubTooltip({ members, day, si, fk, schedule, mousePos, visible, timeSlots }) {
  const tooltipRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!visible || !tooltipRef.current) return;
    const tip  = tooltipRef.current.getBoundingClientRect();
    let top  = mousePos.y + 14;
    let left = mousePos.x + 14;
    if (top + tip.height + 8 > window.innerHeight) top = mousePos.y - tip.height - 8;
    if (left + tip.width + 8 > window.innerWidth) left = mousePos.x - tip.width - 8;
    setPos({ top, left });
  }, [visible, mousePos]);
  if (!visible) return null;

  const assignedInSlot = Object.values(schedule[day][si]).filter(Boolean);
  const currentName    = schedule[day][si][fk];
  const currentMember  = members.find(m => m.name === currentName);
  const subs           = getAvailableMembers(members, day, si, timeSlots).filter(m => m.name !== currentName);
  const subsFree       = subs.filter(m => !assignedInSlot.includes(m.name));
  const subsAssigned   = subs.filter(m =>  assignedInSlot.includes(m.name));

  // 현재 인원의 이번 주 수업 시간
  const allClasses = currentMember?.classes || [];
  const classesThisWeek = allClasses.reduce((acc, c) => {
    const key = c.day;
    if (!acc[key]) acc[key] = [];
    acc[key].push(`${c.startHour}:${String(c.startMin).padStart(2,"0")}~${c.endHour}:${String(c.endMin).padStart(2,"0")}`);
    return acc;
  }, {});
  const dayOrder = ["월","화","수","목","금","토","일"];

  return (
    <div ref={tooltipRef} style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }} className="sub-tooltip">
      <div className="sub-tooltip-header">
        <span>대체 가능 인원</span>
        <span className="sub-slot-info">{day}요일 {timeSlots[si].label.split("\n")[0]} · {FLOOR_LABEL[fk]}</span>
      </div>
      {subs.length === 0 ? <div className="sub-empty">대체 가능 인원 없음</div> : (
        <>
          {subsFree.length > 0 && (
            <div className="sub-section">
              <div className="sub-section-label free">여유 인원</div>
              <div className="sub-chips">
                {subsFree.map(m => (
                  <div key={m.name} className="sub-chip" style={{ borderColor: m.color + "99" }}>
                    <span className="sub-chip-dot" style={{ background: m.color }} />
                    <span style={{ color: m.color, fontWeight: 700 }}>{m.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {subsAssigned.length > 0 && (
            <div className="sub-section">
              <div className="sub-section-label busy">타 층 배치 중</div>
              <div className="sub-chips">
                {subsAssigned.map(m => (
                  <div key={m.name} className="sub-chip" style={{ borderColor: m.color + "bb" }}>
                    <span className="sub-chip-dot" style={{ background: m.color }} />
                    <span style={{ color: m.color, fontWeight: 700 }}>{m.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {Object.keys(classesThisWeek).length > 0 && (
        <div className="sub-section" style={{ borderTop: "1px solid #eee", marginTop: 6, paddingTop: 6 }}>
          <div className="sub-section-label">{currentName} 수업</div>
          {dayOrder.filter(d => classesThisWeek[d]).map(d => (
            <div key={d} style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", minWidth: 16 }}>{d}</span>
              <div className="sub-chips" style={{ margin: 0 }}>
                {classesThisWeek[d].map((t, i) => (
                  <div key={i} className="sub-chip" style={{ borderColor: "var(--rule-2)", background: "var(--field)", color: "var(--ink-3)" }}>
                    {t}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
