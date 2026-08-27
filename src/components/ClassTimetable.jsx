import { useMemo, useState } from "react";
import { sortedByName } from "../utils";
import { buildClassGrid } from "../classgrid";

// 학생 전원의 수업을 한 장에 겹쳐 본다.
// 근무표와 같은 요일×시간 축을 쓴다 — 축이 달라지면 "이 시간에 누가 비나"를 눈으로 못 맞춘다.

const PANES = {
  class: { pick: "수업 중",        title: "📕 수업 중",        sub: "이 시간엔 근무 불가" },
  free:  { pick: "비어 있는 사람", title: "🟢 근무 가능",      sub: "이 시간엔 수업 없음" },
};

// 새 탭은 같은 페이지를 #classes 해시로 연다.
// 창 이름을 주므로 여러 번 눌러도 탭은 하나. 데이터는 그 탭이 Firebase에서 직접 구독하니
// 부모 창과 값을 주고받을 필요가 없다 (두 탭의 내용이 갈라질 여지를 아예 없앤다)
export const openClassTab = () =>
  window.open(`${window.location.pathname}${window.location.search}#classes`, "libraryClassTimetable");

// 나란히 보기(split)도 표는 하나다.
// 표를 둘로 띄우면 칸에 든 이름 수가 달라 행 높이가 어긋나고, 그러면 같은 시간대가 좌우로 밀린다
function PaneTable({ panes, days, hours, grid, freeGrid }) {
  const split = panes.length > 1;
  const fmt = c => `${c.startHour}:${String(c.startMin).padStart(2, "0")}~${c.endHour}:${String(c.endMin).padStart(2, "0")}`;
  const chip = (key, name, color, title) => (
    <span key={key} className="class-chip" style={{ background: (color || "#90a4ae") + "26", color: color || "#546e7a" }} title={title}>
      {name}
    </span>
  );
  const cellOf = (pane, d, h) => pane === "class"
    ? grid[d][h].map((c, i) => chip(i, c.name, c.color, `${c.name} · ${fmt(c)}`))
    : freeGrid[d][h].length === 0
      ? <span className="class-none">전원 수업</span>
      : freeGrid[d][h].map(m => chip(m.name, m.name, m.color, `${m.name} · 이 시간 수업 없음`));

  return (
    <div className="table-wrap">
      <table className={"sched-table class-table" + (split ? " split-table" : "")}>
        <thead>
          {split && (
            <tr>
              <th className="th-time" rowSpan={2}>시간</th>
              {panes.map((p, pi) => (
                <th key={p} colSpan={days.length} className={`th-day th-pane ${pi ? "pane-start alt" : ""}`}>
                  {PANES[p].title} <span className="th-pane-sub">{PANES[p].sub}</span>
                </th>
              ))}
            </tr>
          )}
          <tr>
            {!split && <th className="th-time">시간</th>}
            {panes.flatMap((p, pi) => days.map((d, di) => (
              <th key={p + d} className={`th-day ${split ? "th-sub" : ""} ${pi && !di ? "pane-start" : ""}`}>{d}</th>
            )))}
          </tr>
        </thead>
        <tbody>
          {hours.map(h => (
            <tr key={h}>
              <td className="td-time">{String(h).padStart(2, "0")}:00~{String(h + 1).padStart(2, "0")}:00</td>
              {panes.flatMap((p, pi) => days.map((d, di) => (
                <td key={p + d} className={`td-class ${p === "free" ? "td-free" : ""} ${pi && !di ? "pane-start" : ""}`}>
                  {cellOf(p, d, h)}
                </td>
              )))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 모달(근무표 위에 띄우기)과 새 탭 화면이 같은 본문을 쓴다.
// mode는 바깥에서 들고 있다 — 모달은 나란히 보기일 때 창을 넓혀야 하므로 이 값을 알아야 한다
export function ClassTimetableView({ members, cfg, mode, setMode }) {
  // 인원 필터 — 비어 있으면 전원. 몇 명만 남기면 그 사람들 시간이 겹치는지 바로 보인다
  const [picked, setPicked] = useState([]);
  const roster = useMemo(() => sortedByName(members), [members]);
  const shown = picked.length ? roster.filter(m => picked.includes(m.name)) : roster;
  const toggle = name => setPicked(p => (p.includes(name) ? p.filter(x => x !== name) : [...p, name]));

  const { days, hours, grid, freeGrid } = useMemo(() => buildClassGrid(shown, cfg), [roster, picked, cfg]);
  const panes = mode === "split" ? ["class", "free"] : [mode];

  return (
    <>
      <div className="class-toolbar">
        <div className="mode-switch">
          <button className={mode === "class" ? "on" : ""} onClick={() => setMode("class")}>{PANES.class.pick}</button>
          <button className={mode === "free"  ? "on" : ""} onClick={() => setMode("free")}>{PANES.free.pick}</button>
          <button className={mode === "split" ? "on" : ""} onClick={() => setMode("split")}>◧ 나란히 보기</button>
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
      <PaneTable panes={panes} days={days} hours={hours} grid={grid} freeGrid={freeGrid} />
      <p className="class-foot">
        {mode === "class"
          ? <>칸에 있는 학생은 그 시간에 <b>수업 중</b>이라 근무를 넣을 수 없습니다.</>
          : mode === "free"
            ? <>칸에 있는 학생은 그 시간에 <b>수업이 없어</b> 근무를 넣을 수 있습니다.</>
            : <>같은 줄이 같은 시간대입니다 — 왼쪽은 그 시간에 <b>수업 중</b>인 학생, 오른쪽은 <b>근무를 넣을 수 있는</b> 학생입니다.</>}
      </p>
    </>
  );
}

export default function ClassTimetable({ members, cfg, onClose }) {
  const [mode, setMode] = useState("class");
  return (
    <div className="cell-popup-overlay" onClick={onClose}>
      <div className={"cell-popup class-modal" + (mode === "split" ? " wide" : "")} onClick={e => e.stopPropagation()}>
        <div className="class-modal-head">
          <h3 style={{ margin: 0, fontSize: 15, color: "#1976d2" }}>📚 학생 수업시간표</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn-back" style={{ padding: "6px 14px" }}
              title="근무표와 나란히 놓고 보려면 새 탭으로 여세요. 수업을 고치면 그 탭도 바로 따라옵니다"
              onClick={openClassTab}>🗗 새 탭으로 열기</button>
            <button className="btn-back" style={{ padding: "6px 14px" }} onClick={onClose}>닫기</button>
          </div>
        </div>
        <ClassTimetableView members={members} cfg={cfg} mode={mode} setMode={setMode} />
      </div>
    </div>
  );
}
