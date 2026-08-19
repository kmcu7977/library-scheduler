import { useMemo, useState } from "react";
import { DAYS, DAYS_KR } from "../constants";

// 학생 전원의 수업을 한 장에 겹쳐 본다.
// 근무표와 같은 요일×시간 축을 쓴다 — 축이 달라지면 "이 시간에 누가 비나"를 눈으로 못 맞춘다.
export default function ClassTimetable({ members, cfg, onClose }) {
  // 인원 필터 — 비어 있으면 전원. 몇 명만 남기면 그 사람들 시간이 겹치는지 바로 보인다
  const [picked, setPicked] = useState([]);
  const shown = picked.length ? members.filter(m => picked.includes(m.name)) : members;
  const toggle = name => setPicked(p => (p.includes(name) ? p.filter(x => x !== name) : [...p, name]));

  const { days, hours, grid, noClass } = useMemo(() => {
    const items = shown.flatMap(m => (m.classes || []).map(c => ({ ...c, name: m.name, color: m.color })));

    // 주말 수업은 있을 때만 열을 만든다 (근무는 월~금이지만 수업은 볼 수 있어야 하므로)
    const days = DAYS_KR.filter(d => DAYS.includes(d) || items.some(c => c.day === d));

    // 시간 축은 개관~폐관을 기본으로, 그 밖으로 삐져나온 수업까지 덮는다
    const starts = items.map(c => c.startHour + c.startMin / 60);
    const ends = items.map(c => c.endHour + c.endMin / 60);
    const from = Math.floor(Math.min(cfg.openHour + cfg.openMin / 60, ...starts));
    const to = Math.ceil(Math.max(cfg.closeHour + cfg.closeMin / 60, ...ends));
    const hours = [];
    for (let h = from; h < to; h++) hours.push(h);

    // grid[요일][시각] = 그 한 시간에 걸치는 수업들
    const grid = {};
    for (const d of days) {
      grid[d] = {};
      for (const h of hours) {
        grid[d][h] = items.filter(c =>
          c.day === d && c.startHour + c.startMin / 60 < h + 1 && c.endHour + c.endMin / 60 > h);
      }
    }
    return { days, hours, grid, noClass: shown.filter(m => !(m.classes || []).length) };
  }, [members, picked, cfg]); // shown은 이 둘에서 파생된다

  const fmt = c => `${c.startHour}:${String(c.startMin).padStart(2, "0")}~${c.endHour}:${String(c.endMin).padStart(2, "0")}`;

  return (
    <div className="cell-popup-overlay" onClick={onClose}>
      <div className="cell-popup class-modal" onClick={e => e.stopPropagation()}>
        <div className="class-modal-head">
          <h3 style={{ margin: 0, fontSize: 15, color: "#1976d2" }}>📚 학생 수업시간표</h3>
          <button className="btn-back" style={{ padding: "6px 14px" }} onClick={onClose}>닫기</button>
        </div>
        <div className="class-filter">
          <button className={"class-pick" + (picked.length === 0 ? " on" : "")}
            style={picked.length === 0 ? { borderColor: "#1976d2", color: "#1976d2", background: "#e3f2fd" } : {}}
            onClick={() => setPicked([])}>
            전체 {members.length}명
          </button>
          {members.map(m => {
            const on = picked.includes(m.name);
            return (
              <button key={m.name} className={"class-pick" + (on ? " on" : "")}
                style={on ? { borderColor: m.color, color: m.color, background: m.color + "1f" } : {}}
                onClick={() => toggle(m.name)}>
                {on && "✓ "}{m.name}
              </button>
            );
          })}
        </div>
        <div className="table-wrap">
          <table className="sched-table class-table">
            <thead>
              <tr>
                <th className="th-time">시간</th>
                {days.map(d => <th key={d} className="th-day">{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {hours.map(h => (
                <tr key={h}>
                  <td className="td-time">{String(h).padStart(2, "0")}:00~{String(h + 1).padStart(2, "0")}:00</td>
                  {days.map(d => (
                    <td key={d} className="td-class">
                      {grid[d][h].map((c, i) => (
                        <span key={i} className="class-chip"
                          style={{ background: (c.color || "#90a4ae") + "26", color: c.color || "#546e7a" }}
                          title={`${c.name} · ${fmt(c)}`}>
                          {c.name}
                        </span>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="class-foot">
          칸에 있는 학생은 그 시간에 <b>수업 중</b>이라 근무를 넣을 수 없습니다.
          {noClass.length > 0 && <> · 수업 미입력: {noClass.map(m => m.name).join(", ")}</>}
        </p>
      </div>
    </div>
  );
}
