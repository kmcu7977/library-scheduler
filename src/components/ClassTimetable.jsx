import { useMemo, useState } from "react";
import { sortedByName } from "../utils";
import { buildClassGrid } from "../classgrid";

// 학생 전원의 수업을 한 장에 겹쳐 본다.
// 근무표와 같은 요일×시간 축을 쓴다 — 축이 달라지면 "이 시간에 누가 비나"를 눈으로 못 맞춘다.

export const PANES = {
  class: { pick: "수업 중",        title: "📕 수업 중",   tab: "수업 중인 학생" },
  free:  { pick: "근무 가능",      title: "🟢 근무 가능", tab: "근무 가능한 학생" },
};

// 두 화면을 나란히 보려면 탭을 두 개 띄운다 — 배치는 창 관리(윈도우 스냅)에 맡기는 편이
// 한 표를 열 묶음으로 쪼개는 것보다 넓게 쓰고, 표도 원래 폭 그대로 남는다.
// 창 이름을 모드별로 주므로 여러 번 눌러도 탭은 둘 뿐이고, 각 탭이 Firebase를 직접 구독해
// 본 탭에서 수업을 고치면 새로고침 없이 따라온다
const openTab = mode =>
  window.open(`${window.location.pathname}${window.location.search}#classes/${mode}`, "libraryClassTab-" + mode);

export const openClassTabs = () => {
  const opened = ["class", "free"].map(openTab);
  // 두 번째 창은 팝업 차단에 걸리는 브라우저가 있다 — 조용히 안 열리면 원인을 알 수 없으므로 알린다
  if (opened.some(w => !w)) alert("탭이 열리지 않았습니다. 이 사이트의 팝업 차단을 해제해주세요.");
};

function ClassGridTable({ mode, days, hours, grid, freeGrid }) {
  const fmt = c => `${c.startHour}:${String(c.startMin).padStart(2, "0")}~${c.endHour}:${String(c.endMin).padStart(2, "0")}`;
  const chip = (key, name, color, title) => (
    <span key={key} className="class-chip" style={{ background: (color || "#90a4ae") + "26", color: color || "#546e7a" }} title={title}>
      {name}
    </span>
  );
  return (
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
                <td key={d} className={"td-class" + (mode === "free" ? " td-free" : "")}>
                  {mode === "class"
                    ? grid[d][h].map((c, i) => chip(i, c.name, c.color, `${c.name} · ${fmt(c)}`))
                    : freeGrid[d][h].length === 0
                      ? <span className="class-none">전원 수업</span>
                      : freeGrid[d][h].map(m => chip(m.name, m.name, m.color, `${m.name} · 이 시간 수업 없음`))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 모달(근무표 위에 띄우기)과 새 탭 화면이 같은 본문을 쓴다.
// mode는 바깥에서 들고 있다 — 새 탭은 주소(#classes/free)로 어느 화면인지가 정해지기 때문
export function ClassTimetableView({ members, cfg, mode, setMode }) {
  // 인원 필터 — 비어 있으면 전원. 몇 명만 남기면 그 사람들 시간이 겹치는지 바로 보인다
  const [picked, setPicked] = useState([]);
  const roster = useMemo(() => sortedByName(members), [members]);
  const shown = picked.length ? roster.filter(m => picked.includes(m.name)) : roster;
  const toggle = name => setPicked(p => (p.includes(name) ? p.filter(x => x !== name) : [...p, name]));

  const { days, hours, grid, freeGrid } = useMemo(() => buildClassGrid(shown, cfg), [roster, picked, cfg]);

  return (
    <>
      <div className="class-toolbar">
        <div className="mode-switch">
          {Object.entries(PANES).map(([key, p]) => (
            <button key={key} className={mode === key ? "on" : ""} onClick={() => setMode(key)}>{p.pick}</button>
          ))}
        </div>
        <span className="class-count">
          {picked.length ? `${shown.length}명 보는 중` : `전체 ${roster.length}명`}
        </span>
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
      <ClassGridTable mode={mode} days={days} hours={hours} grid={grid} freeGrid={freeGrid} />
      <p className="class-foot">
        {mode === "class"
          ? <>칸에 있는 학생은 그 시간에 <b>수업 중</b>이라 근무를 넣을 수 없습니다.</>
          : <>칸에 있는 학생은 그 시간에 <b>수업이 없어</b> 근무를 넣을 수 있습니다.</>}
      </p>
    </>
  );
}

export default function ClassTimetable({ members, cfg, onClose }) {
  const [mode, setMode] = useState("class");
  return (
    <div className="cell-popup-overlay" onClick={onClose}>
      <div className="cell-popup class-modal" onClick={e => e.stopPropagation()}>
        <div className="class-modal-head">
          <h3 style={{ margin: 0, fontSize: 15, color: "#1976d2" }}>📚 학생 수업시간표</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn-back" style={{ padding: "6px 14px" }}
              title="수업 중 / 근무 가능 화면을 각각 새 탭으로 엽니다. 두 창을 좌우로 붙여 놓고 보세요"
              onClick={openClassTabs}>🗗 탭 2개로 열기</button>
            <button className="btn-back" style={{ padding: "6px 14px" }} onClick={onClose}>닫기</button>
          </div>
        </div>
        <ClassTimetableView members={members} cfg={cfg} mode={mode} setMode={setMode} />
      </div>
    </div>
  );
}
