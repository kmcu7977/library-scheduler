import { useMemo, useState } from "react";
import { DAYS, DAYS_KR } from "../constants";
import { sortedByName } from "../utils";

// 학생 전원의 수업을 한 장에 겹쳐 본다.
// 근무표와 같은 요일×시간 축을 쓴다 — 축이 달라지면 "이 시간에 누가 비나"를 눈으로 못 맞춘다.
export default function ClassTimetable({ members, cfg, onClose }) {
  // 인원 필터 — 비어 있으면 전원. 몇 명만 남기면 그 사람들 시간이 겹치는지 바로 보인다
  const [picked, setPicked] = useState([]);
  const roster = useMemo(() => sortedByName(members), [members]);
  const shown = picked.length ? roster.filter(m => picked.includes(m.name)) : roster;
  const toggle = name => setPicked(p => (p.includes(name) ? p.filter(x => x !== name) : [...p, name]));

  // 보기 전환 — 수업 중인 사람 / 그 시간에 비어 있는 사람.
  // 배치할 때 실제로 궁금한 건 후자라서 칸 내용을 통째로 뒤집는다
  const [mode, setMode] = useState("class");

  const { days, hours, grid, freeGrid, noClass } = useMemo(() => {
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

    // grid[요일][시각] = 그 한 시간에 걸치는 수업들 / freeGrid = 그 시간에 수업이 없는 사람들
    const grid = {}, freeGrid = {};
    for (const d of days) {
      grid[d] = {};
      freeGrid[d] = {};
      for (const h of hours) {
        grid[d][h] = items.filter(c =>
          c.day === d && c.startHour + c.startMin / 60 < h + 1 && c.endHour + c.endMin / 60 > h);
        const busy = new Set(grid[d][h].map(c => c.name));
        freeGrid[d][h] = shown.filter(m => !busy.has(m.name));
      }
    }
    return { days, hours, grid, freeGrid, noClass: shown.filter(m => !(m.classes || []).length) };
  }, [roster, picked, cfg]); // shown은 이 둘에서 파생된다

  const fmt = c => `${c.startHour}:${String(c.startMin).padStart(2, "0")}~${c.endHour}:${String(c.endMin).padStart(2, "0")}`;

  return (
    <div className="cell-popup-overlay" onClick={onClose}>
      <div className="cell-popup class-modal" onClick={e => e.stopPropagation()}>
        <div className="class-modal-head">
          <h3 style={{ margin: 0, fontSize: 15, color: "#1976d2" }}>📚 학생 수업시간표</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="mode-switch">
              <button className={mode === "class" ? "on" : ""} onClick={() => setMode("class")}>수업 중</button>
              <button className={mode === "free" ? "on" : ""} onClick={() => setMode("free")}>비어 있는 사람</button>
            </div>
            <button className="btn-back" style={{ padding: "6px 14px" }} onClick={onClose}>닫기</button>
          </div>
        </div>
        <div className="class-filter">
          <button className={"class-pick" + (picked.length === 0 ? " on" : "")}
            style={picked.length === 0 ? { borderColor: "#1976d2", color: "#1976d2", background: "#e3f2fd" } : {}}
            onClick={() => setPicked([])}>
            전체 {members.length}명
          </button>
          {roster.map(m => {
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
                      {mode === "class"
                        ? grid[d][h].map((c, i) => (
                          <span key={i} className="class-chip"
                            style={{ background: (c.color || "#90a4ae") + "26", color: c.color || "#546e7a" }}
                            title={`${c.name} · ${fmt(c)}`}>
                            {c.name}
                          </span>
                        ))
                        : freeGrid[d][h].length === 0
                          ? <span className="class-none">전원 수업</span>
                          : freeGrid[d][h].map(m => (
                            <span key={m.name} className="class-chip"
                              style={{ background: (m.color || "#90a4ae") + "26", color: m.color || "#546e7a" }}
                              title={`${m.name} · 이 시간 수업 없음`}>
                              {m.name}
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
          {mode === "class"
            ? <>칸에 있는 학생은 그 시간에 <b>수업 중</b>이라 근무를 넣을 수 없습니다.</>
            : <>칸에 있는 학생은 그 시간에 <b>수업이 없어</b> 근무를 넣을 수 있습니다.</>}
          {noClass.length > 0 && (
            mode === "free"
              ? <span style={{ display: "block", marginTop: 4, color: "#e65100" }}>
                  ⚠️ 수업을 입력하지 않은 <b>{noClass.length}명</b>({noClass.map(m => m.name).join(", ")})은
                  모든 시간에 비어 있는 것으로 나옵니다. 실제로 비는지는 확인이 필요합니다.
                </span>
              : <> · 수업 미입력: {noClass.map(m => m.name).join(", ")}</>
          )}
        </p>
      </div>
    </div>
  );
}
