import { useState, useMemo, useEffect } from "react";
import { DAYS, FLOOR_KEYS, FLOOR_LABEL } from "../constants";
import { isClassTime, sortedByName, isLunchSlot } from "../utils";
import { recommend, audit } from "../recommend";
import ScheduleCell from "./ScheduleCell";
import ClassTimetable from "./ClassTimetable";

export default function ScheduleEditor({ members, schedule, setSchedule, pins, setPins, onRegenerate, onExport, onBack, timeSlots, cfg }) {
  const [editCell, setEditCell] = useState(null);   // { day, fk, sis:[슬롯…] } — 드래그로 여러 칸 선택 가능
  const [drag, setDrag] = useState(null);           // { day, fk, from, to } — 드래그 진행 중
  const [hoveredMember, setHoveredMember] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [showClasses, setShowClasses] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // 표의 열 = 요일 × 층. 드래그는 이 열 축과 시간 축으로 이루어진 사각 영역이다
  // (세로 한 줄, 여러 요일 가로지르기, 대각선 모두 같은 규칙으로 처리된다)
  const COLS = DAYS.flatMap(day => FLOOR_KEYS.map(fk => ({ day, fk })));
  const colOf = (day, fk) => DAYS.indexOf(day) * FLOOR_KEYS.length + FLOOR_KEYS.indexOf(fk);
  const rectOf = d => {
    const [c0, c1] = [Math.min(d.fromCol, d.toCol), Math.max(d.fromCol, d.toCol)];
    const [s0, s1] = [Math.min(d.fromSi, d.toSi), Math.max(d.fromSi, d.toSi)];
    return { c0, c1, s0, s1 };
  };
  const cellsOf = d => {
    const { c0, c1, s0, s1 } = rectOf(d);
    const cells = [];
    for (let c = c0; c <= c1; c++) for (let si = s0; si <= s1; si++) cells.push({ ...COLS[c], si });
    return cells;
  };

  useEffect(() => {
    if (!drag) return;
    const finish = () => { setEditCell({ cells: cellsOf(drag) }); setDrag(null); };
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  }, [drag]);

  const inDrag = (day, si, fk) => {
    if (!drag) return false;
    const { c0, c1, s0, s1 } = rectOf(drag);
    const c = colOf(day, fk);
    return c >= c0 && c <= c1 && si >= s0 && si <= s1;
  };
  const inEdit = (day, si, fk) =>
    !!editCell && editCell.cells.some(x => x.day === day && x.si === si && x.fk === fk);

  const isPinned = (day, si, fk) => !!pins?.[day]?.[si]?.[fk];
  const pinCount = useMemo(
    () => Object.values(pins || {}).reduce((a, d) => a + Object.values(d).reduce((b, r) => b + Object.keys(r).length, 0), 0),
    [pins]
  );

  // 칸 고정 추가/해제 (name이 null이면 해제)
  const setPin = (day, si, fk, name) => {
    setPins(prev => {
      const next = { ...(prev || {}), [day]: { ...(prev?.[day] || {}) } };
      const row = { ...(next[day][si] || {}) };
      if (name) row[fk] = name;
      else delete row[fk];
      if (Object.keys(row).length) next[day][si] = row;
      else {
        delete next[day][si];
        if (!Object.keys(next[day]).length) delete next[day];
      }
      return next;
    });
  };

  const handleRegenerate = () => {
    setRegenerating(true);
    // 렌더가 "재배치 중..."을 먼저 그리도록 한 틱 미룸 (생성은 1~3초 소요)
    setTimeout(() => { onRegenerate(); setRegenerating(false); }, 30);
  };

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

  const nightHourMap = useMemo(() => {
    const map = {};
    members.forEach(m => { map[m.name] = 0; });
    DAYS.forEach(day => {
      timeSlots.forEach((slot, si) => {
        if (slot.startH < 17) return;
        FLOOR_KEYS.forEach(fk => {
          const n = schedule[day]?.[si]?.[fk];
          if (n && map[n] !== undefined) map[n] += slot.hours;
        });
      });
    });
    return map;
  }, [members, schedule, timeSlots]);

  // 열려 있는 자리에 대한 후보 순위 — 판단은 사서가, 근거는 도구가
  const recommended = useMemo(
    () => (editCell ? recommend(members, schedule, timeSlots, cfg, editCell.cells) : []),
    [editCell, members, schedule, timeSlots, cfg]
  );

  // 지정한 칸은 자동배치가 손대지 않으므로, 배치 후 수업이 바뀌면 충돌이 조용히 남는다 → 눈에 보이게
  const issues = useMemo(() => audit(members, schedule, timeSlots, cfg), [members, schedule, timeSlots, cfg]);

  // 수동 배치 = 자동 고정 (빈칸 채우기를 해도 유지), 비우기 = 고정 해제 + 칸 비움
  const assignMember = name => {
    if (!editCell) return;
    setSchedule(prev => {
      const next = { ...prev };
      for (const c of editCell.cells) {
        next[c.day] = (next[c.day] === prev[c.day] ? [...prev[c.day]] : next[c.day]);
        next[c.day][c.si] = { ...(next[c.day][c.si] || {}), [c.fk]: name || null };
      }
      return next;
    });
    editCell.cells.forEach(c => setPin(c.day, c.si, c.fk, name || null));
    setEditCell(null);
  };

  // 이름은 그대로 두고 고정만 해제 (빈칸 채우기 때 자동배치 대상이 됨)
  const unpinCell = () => {
    if (!editCell) return;
    editCell.cells.forEach(c => setPin(c.day, c.si, c.fk, null));
    setEditCell(null);
  };

  const editPinned = !!editCell && editCell.cells.some(c => isPinned(c.day, c.si, c.fk));

  // 시간표 전체 비우기 — 배치와 고정(📌)을 함께 지운다. 인원·수업 데이터는 그대로 둔다
  const clearAll = () => {
    setSchedule(prev => Object.fromEntries(DAYS.map(day =>
      [day, (prev[day] || []).map(() => ({ f2: null, f3a: null, f3b: null, f4: null }))])));
    setPins({});
    setConfirmClear(false);
  };

  // 팝업 제목: 여러 요일·층에 걸칠 수 있으므로 범위로 요약한다
  const editSummary = useMemo(() => {
    if (!editCell) return null;
    const uniq = (arr, order) => [...new Set(arr)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const days = uniq(editCell.cells.map(c => c.day), DAYS);
    const floors = uniq(editCell.cells.map(c => FLOOR_LABEL[c.fk]), ["2층", "3층", "4층"]);
    const sis = editCell.cells.map(c => c.si);
    const lo = Math.min(...sis), hi = Math.max(...sis);
    const at = (i, part) => timeSlots[i].label.split("\n")[0].split("~")[part];
    return {
      days: days.length > 2 ? `${days[0]}~${days[days.length - 1]}요일` : days.join("·") + "요일",
      time: `${at(lo, 0)}~${at(hi, 1)}`,
      floors: floors.join("·"),
    };
  }, [editCell, timeSlots]);

  return (
    <div className="step-card wide">
      <div className="editor-header">
        <h2 className="step-title" style={{ margin: 0 }}>③ 시간표 확인 및 수정</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="cfg-badge">🕐 {cfg.openHour}:{String(cfg.openMin).padStart(2,"0")}~{cfg.closeHour}:{String(cfg.closeMin).padStart(2,"0")} · 기본 주{cfg.maxWeeklyHours}h / 일{cfg.maxDailyHours}h</div>
          <div className="hover-hint">💡 드래그하면 가로·세로·대각선 어느 방향이든 영역으로 한 번에 지정합니다</div>
        </div>
      </div>
      <div className="weekly-bar">
        {sortedByName(members).map(m => {
          const maxW = m.weeklyHours ?? cfg.maxWeeklyHours;
          const h = weeklyMap[m.name] || 0;
          const nh = nightHourMap[m.name] || 0;
          const over = h > maxW;
          const fillPct = Math.min(h / maxW * 100, 100);
          const nightPct = h > 0 ? (nh / h) * fillPct : 0;
          const dayPct = fillPct - nightPct;
          return (
            <div key={m.name} className="weekly-item">
              <span className="weekly-name" style={{ color: m.color }}>
                {m.name}
                {maxW !== cfg.maxWeeklyHours && <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, background: "#1a237e", color: "#fff", borderRadius: 4, padding: "1px 4px" }}>{maxW}h</span>}
              </span>
              <div className="weekly-track" style={{ display: "flex" }}>
                <div style={{ width: `${dayPct}%`, height: "100%", background: over ? "#e06c75" : m.color, borderRadius: "3px 0 0 3px" }} />
                <div style={{ width: `${nightPct}%`, height: "100%", background: over ? "#b71c1c" : "#1a237e", borderRadius: nightPct > 0 ? "0 3px 3px 0" : 0 }} />
              </div>
              <span className={`weekly-h ${over ? "over" : ""}`}>
                {h} / {maxW}h
                {nh > 0 && <span style={{ fontSize: 10, color: "#5c6bc0", marginLeft: 3 }}>(야{nh}h)</span>}
              </span>
            </div>
          );
        })}
      </div>
      {issues.length > 0 && (
        <div className={`audit-bar ${issues.some(i => i.level === "error") ? "audit-error" : ""}`}>
          <b>{issues.some(i => i.level === "error") ? "⚠️ 확인이 필요합니다" : "한도를 넘긴 배치가 있습니다"}</b>
          <span>
            {issues.slice(0, 4).map((i, k) => <em key={k} className={i.level}>{i.text}</em>)}
            {issues.length > 4 && <em>외 {issues.length - 4}건</em>}
          </span>
        </div>
      )}
      <div className="table-wrap">
        <table className="sched-table">
          <thead>
            <tr>
              <th className="th-time" rowSpan={2}>시간</th>
              {DAYS.map((day, i) => <th key={day} colSpan={4} className={`th-day day-start ${i % 2 ? "alt" : ""}`}>{day}</th>)}
            </tr>
            <tr>
              {DAYS.flatMap(day => [
                <th key={`${day}-f2`} className="th-floor day-start">2층</th>,
                <th key={`${day}-f3`} className="th-floor" colSpan={2}>3층</th>,
                <th key={`${day}-f4`} className="th-floor">4층</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {timeSlots.map((slot, si) => (
              <tr key={si}>
                <td className={`td-time ${isLunchSlot(slot) ? "lunch-row" : ""}`}>{slot.label}</td>
                {DAYS.flatMap(day => {
                  const cellProps = (fk) => ({
                    key: `${day}-${fk}`,
                    fk, day, si, members, schedule, timeSlots,
                    name: schedule[day]?.[si]?.[fk] || "",
                    pinned: isPinned(day, si, fk),
                    lunch: isLunchSlot(slot),
                    active: inEdit(day, si, fk),
                    selected: inDrag(day, si, fk),
                    dragging: !!drag,
                    onDragStart: () => setDrag({ fromCol: colOf(day, fk), toCol: colOf(day, fk), fromSi: si, toSi: si }),
                    onDragOver: () => setDrag(d => (d ? { ...d, toCol: colOf(day, fk), toSi: si } : d)),
                    onHoverMember: setHoveredMember,
                    dim: hoveredMember
                      ? isClassTime(members.find(m => m.name === hoveredMember), day, si, timeSlots)
                      : false,
                  });
                  return [
                    <ScheduleCell {...cellProps("f2")} dayStart />,
                    <ScheduleCell {...cellProps("f3a")} />,
                    <ScheduleCell {...cellProps("f3b")} />,
                    <ScheduleCell {...cellProps("f4")} />,
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
              {editSummary.days} {editSummary.time}
              {editCell.cells.length > 1 && <span style={{ color: "#1976d2", fontWeight: 700 }}> ({editCell.cells.length}칸)</span>}<br />
              <span style={{ color: "#1976d2" }}>{editSummary.floors}</span> 담당자 지정
              <span style={{ display: "block", fontSize: 11, color: "#90a4ae", marginTop: 4 }}>
                적합한 순서로 정렬했습니다 · 회색은 배치 불가, 주황 표시는 한도를 넘지만 지정은 가능합니다
              </span>
            </p>
            <div className="rec-list">
              {recommended.map((r, idx) => {
                const m = r.member;
                const best = idx === 0 && r.blocked.length === 0;
                const dimmed = r.conflicts.length > 0;
                return (
                  <button key={m.name} className={`rec-row ${dimmed ? "rec-off" : ""} ${best ? "rec-best" : ""}`}
                    style={{ borderColor: m.color + (dimmed ? "33" : "99") }}
                    onClick={() => !dimmed && assignMember(m.name)}
                    title={dimmed ? r.conflicts.join(", ") : "이 사람으로 지정"}>
                    <span className="rec-name" style={{ color: dimmed ? "#b0bec5" : m.color }}>
                      {best && <span className="rec-star">추천</span>}
                      {m.name}
                      {r.isCurrent && <span className="rec-now">현재</span>}
                    </span>
                    <span className="rec-why">
                      {r.conflicts.map(c => <em key={c} className="rec-bad">{c}</em>)}
                      {r.warnings.map(w => <em key={w} className="rec-warn">{w}</em>)}
                      {r.conflicts.length === 0 && r.why.map(w => <em key={w}>{w}</em>)}
                    </span>
                    <span className="rec-remain">여유 {r.remain}h</span>
                  </button>
                );
              })}
            </div>
            <div className="popup-members" style={{ marginTop: 12 }}>
              <button className="popup-member-btn clear-btn" onClick={() => assignMember(null)}>비우기</button>
              {editPinned && (
                <button className="popup-member-btn clear-btn" style={{ color: "#f57f17", borderColor: "#f9a825" }} onClick={unpinCell}>
                  📌 고정 해제
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="nav-row">
        <button className="btn-back" onClick={onBack}>← 뒤로</button>
        <button className="btn-back" style={{ background: "#1976d2", color: "#fff", borderColor: "#1976d2" }}
          onClick={handleRegenerate} disabled={regenerating}>
          {regenerating ? "⏳ 채우는 중..." : `🪄 빈칸 채우기${pinCount > 0 ? ` (📌${pinCount}칸 유지)` : ""}`}
        </button>
        <button className="btn-back" onClick={() => setShowClasses(true)}>📚 수업시간표</button>
        {pinCount > 0 && (
          <button className="btn-back" style={{ color: "#f57f17", borderColor: "#f9a825" }}
            onClick={() => setPins({})}>📌 전체 고정 해제</button>
        )}
        <button className="btn-back" style={{ color: "#c62828", borderColor: "#ef9a9a" }}
          onClick={() => setConfirmClear(true)}>🧹 시간표 비우기</button>
        <button className="btn-export" onClick={onExport}>📥 엑셀 다운로드</button>
      </div>
      {showClasses && <ClassTimetable members={members} cfg={cfg} onClose={() => setShowClasses(false)} />}
      {confirmClear && (
        <div className="cell-popup-overlay" onClick={() => setConfirmClear(false)}>
          <div className="cell-popup" onClick={e => e.stopPropagation()} style={{ maxWidth: 340, textAlign: "center" }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#c62828", marginBottom: 8 }}>🧹 시간표 비우기</p>
            <p className="popup-title" style={{ marginBottom: 20 }}>
              배치된 인원과 📌 고정이 모두 지워집니다.<br />
              <span style={{ fontSize: 12, color: "#90a4ae" }}>등록한 인원과 수업시간은 그대로 남습니다.</span>
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button className="btn-back" onClick={() => setConfirmClear(false)}>취소</button>
              <button style={{ background: "#c62828", color: "#fff", border: "none", borderRadius: 10, padding: "11px 24px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                onClick={clearAll}>비우기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
