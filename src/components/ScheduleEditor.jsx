import { useState, useMemo } from "react";
import { DAYS, FLOOR_KEYS, FLOOR_LABEL } from "../constants";
import { isClassTime } from "../utils";
import ScheduleCell from "./ScheduleCell";

export default function ScheduleEditor({ members, schedule, setSchedule, onExport, onBack, timeSlots, cfg }) {
  const [editCell, setEditCell] = useState(null);

  const weeklyMap = useMemo(() => {
    const map = {};
    members.forEach(m => { map[m.name] = 0; });
    DAYS.forEach(day => {
      timeSlots.forEach((slot, si) => {
        FLOOR_KEYS.forEach(fk => {
          const n = schedule[day]?.[si]?.[fk];
          if (n && map[n] !== undefined) map[n] += slot.hours;
        });
      });
    });
    return map;
  }, [members, schedule, timeSlots]);

  const assignMember = name => {
    if (!editCell) return;
    const { day, si, fk } = editCell;
    setSchedule(prev => ({ ...prev, [day]: prev[day].map((row, i) => i !== si ? row : { ...row, [fk]: name || null }) }));
    setEditCell(null);
  };

  return (
    <div className="step-card wide">
      <div className="editor-header">
        <h2 className="step-title" style={{ margin: 0 }}>③ 시간표 확인 및 수정</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="cfg-badge">🕐 {cfg.openHour}:{String(cfg.openMin).padStart(2,"0")}~{cfg.closeHour}:{String(cfg.closeMin).padStart(2,"0")} · 주{cfg.maxWeeklyHours}h / 일{cfg.maxDailyHours}h</div>
          <div className="hover-hint">💡 이름에 마우스 올리면 대체 인원 표시</div>
        </div>
      </div>
      <div className="weekly-bar">
        {members.map(m => {
          const h = weeklyMap[m.name] || 0, over = h > cfg.maxWeeklyHours;
          return (
            <div key={m.name} className="weekly-item">
              <span className="weekly-name" style={{ color: m.color }}>{m.name}</span>
              <div className="weekly-track"><div className="weekly-fill" style={{ width: `${Math.min(h / cfg.maxWeeklyHours * 100, 100)}%`, background: over ? "#e06c75" : m.color }} /></div>
              <span className={`weekly-h ${over ? "over" : ""}`}>{h} / {cfg.maxWeeklyHours}h</span>
            </div>
          );
        })}
      </div>
      <div className="table-wrap">
        <table className="sched-table">
          <thead>
            <tr>
              <th className="th-time" rowSpan={2}>시간</th>
              {DAYS.map(day => <th key={day} colSpan={4} className="th-day">{day}</th>)}
            </tr>
            <tr>
              {DAYS.flatMap(day => [
                <th key={`${day}-f2`} className="th-floor">2층</th>,
                <th key={`${day}-f3`} className="th-floor" colSpan={2}>3층</th>,
                <th key={`${day}-f4`} className="th-floor">4층</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {timeSlots.map((slot, si) => (
              <tr key={si}>
                <td className="td-time">{slot.label}</td>
                {DAYS.flatMap(day => {
                  const f3b = schedule[day]?.[si]?.f3b;
                  const merge3 = !f3b;
                  return [
                    <ScheduleCell key={`${day}-f2`}  fk="f2"  name={schedule[day]?.[si]?.f2  || ""} day={day} si={si} members={members} schedule={schedule} timeSlots={timeSlots} active={editCell?.day === day && editCell?.si === si && editCell?.fk === "f2"}  onClick={() => setEditCell({ day, si, fk: "f2"  })} />,
                    <ScheduleCell key={`${day}-f3a`} fk="f3a" name={schedule[day]?.[si]?.f3a || ""} colSpan={merge3 ? 2 : 1} day={day} si={si} members={members} schedule={schedule} timeSlots={timeSlots} active={editCell?.day === day && editCell?.si === si && editCell?.fk === "f3a"} onClick={() => setEditCell({ day, si, fk: "f3a" })} />,
                    ...(merge3 ? [] : [<ScheduleCell key={`${day}-f3b`} fk="f3b" name={schedule[day]?.[si]?.f3b || ""} day={day} si={si} members={members} schedule={schedule} timeSlots={timeSlots} active={editCell?.day === day && editCell?.si === si && editCell?.fk === "f3b"} onClick={() => setEditCell({ day, si, fk: "f3b" })} />]),
                    <ScheduleCell key={`${day}-f4`}  fk="f4"  name={schedule[day]?.[si]?.f4  || ""} day={day} si={si} members={members} schedule={schedule} timeSlots={timeSlots} active={editCell?.day === day && editCell?.si === si && editCell?.fk === "f4"}  onClick={() => setEditCell({ day, si, fk: "f4"  })} />,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editCell && (
        <div className="cell-popup-overlay" onClick={() => setEditCell(null)}>
          <div className="cell-popup" onClick={e => e.stopPropagation()}>
            <p className="popup-title">
              {editCell.day}요일 {timeSlots[editCell.si].label.split("\n")[0]}<br />
              <span style={{ color: "#1976d2" }}>{FLOOR_LABEL[editCell.fk]}</span> 담당자 변경
            </p>
            <div className="popup-members">
              {members.map(m => {
                const isCls = isClassTime(m, editCell.day, editCell.si, timeSlots);
                return (
                  <button key={m.name} className={`popup-member-btn ${isCls ? "has-class" : ""}`}
                    style={{ borderColor: m.color + (isCls ? "44" : ""), color: isCls ? m.color + "55" : m.color }}
                    onClick={() => !isCls && assignMember(m.name)} title={isCls ? "수업 시간과 겹침" : ""}>
                    {m.name}{isCls && <span className="class-badge">수업</span>}
                  </button>
                );
              })}
              <button className="popup-member-btn clear-btn" onClick={() => assignMember(null)}>비우기</button>
            </div>
          </div>
        </div>
      )}
      <div className="nav-row">
        <button className="btn-back" onClick={onBack}>← 뒤로</button>
        <button className="btn-export" onClick={onExport}>📥 엑셀 다운로드</button>
      </div>
    </div>
  );
}
