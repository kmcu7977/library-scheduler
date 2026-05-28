import { useState, useRef, useEffect, useMemo } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get } from "firebase/database";
import * as XLSX from "xlsx";

const firebaseConfig = {
  apiKey:            "AIzaSyBfMCrCsoMUrJQW9zGpRZvVbcghRUHvMfw",
  authDomain:        "library-scheduler-aec7b.firebaseapp.com",
  databaseURL:       "https://library-scheduler-aec7b-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "library-scheduler-aec7b",
  storageBucket:     "library-scheduler-aec7b.firebasestorage.app",
  messagingSenderId: "393819398330",
  appId:             "1:393819398330:web:a80d7446cb63f71e652283",
};
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);
const DB_PATH = "scheduler/data"; // 인수인계 데이터와 경로 분리

// ─── 상수 ────────────────────────────────────────────────────────────────────
const DAYS         = ["월", "화", "수", "목", "금"];
const FLOOR_KEYS   = ["f2", "f3a", "f3b", "f4"];
const FLOOR_LABEL  = { f2: "2층", f3a: "3층", f3b: "3층", f4: "4층" };
const DAYS_KR      = ["월", "화", "수", "목", "금", "토", "일"];
const FLOOR_OPTIONS = ["2층", "3층", "4층"];
const KEY_TO_FLOOR  = { f2: "2층", f3a: "3층", f3b: "3층", f4: "4층" };
const DEFAULT_COLORS = [
  "#4A90D9","#E06C75","#56B6C2","#98C379","#E5C07B",
  "#C678DD","#61AFEF","#D19A66","#BE5046","#2ECC71",
];
const PRESETS = {
  semester: { label: "학기 중", openHour: 8, openMin: 30, closeHour: 21, closeMin: 0, firstSlotMins: 90, slotMins: 60, maxWeeklyHours: 20, maxDailyHours: 8 },
  vacation: { label: "방학",    openHour: 9, openMin: 0,  closeHour: 18, closeMin: 0, firstSlotMins: 60, slotMins: 60, maxWeeklyHours: 40, maxDailyHours: 8 },
};
const EMPTY_INFO = { dept: "", studentId: "", phone: "", note: "" };

// ─── Firebase 저장 / 불러오기 ─────────────────────────────────────────────────
async function saveToFirebase(data) {
  try { await set(ref(db, DB_PATH), data); return true; }
  catch (e) { console.error("Firebase 저장 실패:", e); return false; }
}
async function loadFromFirebase() {
  try {
    const snap = await get(ref(db, DB_PATH));
    return snap.exists() ? snap.val() : null;
  } catch (e) { console.error("Firebase 불러오기 실패:", e); throw e; }
}

// ─── 시간 슬롯 생성 ───────────────────────────────────────────────────────────
function buildTimeSlots(cfg) {
  const fmtH = h => {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
  };
  const slots = [];
  const firstStartH = cfg.openHour + cfg.openMin / 60;
  const firstDur    = cfg.firstSlotMins / 60;
  const firstEndH   = firstStartH + firstDur;
  slots.push({ label: `${fmtH(firstStartH)}~${fmtH(firstEndH)}`, startH: firstStartH, hours: firstDur });
  let cur = firstEndH, lunchCount = 0;
  const closeH = cfg.closeHour + cfg.closeMin / 60, dur = cfg.slotMins / 60;
  while (cur + 0.001 < closeH) {
    const end = Math.min(cur + dur, closeH);
    let label = `${fmtH(cur)}~${fmtH(end)}`;
    if (cur >= 12 && cur < 13 && lunchCount === 0) { label += "\n(점심시간1)"; lunchCount++; }
    else if (cur >= 13 && cur < 14 && lunchCount === 1) { label += "\n(점심시간2)"; lunchCount++; }
    slots.push({ label, startH: cur, hours: end - cur });
    cur = end;
    if (cur >= closeH - 0.001) break;
  }
  return slots;
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────
function isClassTime(member, day, si, timeSlots) {
  if (!member.classes) return false;
  const { startH, hours } = timeSlots[si];
  const endH = startH + hours;
  return member.classes.some(cls => {
    if (cls.day !== day) return false;
    const cs = cls.startHour + cls.startMin / 60, ce = cls.endHour + cls.endMin / 60;
    return cs < endH && ce > startH;
  });
}
function getAvailableMembers(members, day, si, timeSlots) {
  return members.filter(m => !isClassTime(m, day, si, timeSlots));
}
function prefersFloor(member, key) {
  return member.preferFloor ? member.preferFloor === KEY_TO_FLOOR[key] : false;
}
const isLunchSlot     = slot => slot.startH >= 12 && slot.startH < 14;
const isAfternoonSlot = slot => slot.startH >= 14;
const isMorningSlot   = slot => slot.startH < 12;

// ─── 자동 배치 ───────────────────────────────────────────────────────────────
// 우선순위
// 배치 불가 필터: 수업충돌 / 주간한도 / 일일한도 / 점심보호
// 0순위: 선호층 + 직전슬롯 연속 (즉시 확정)
// 1순위: 선호층 그룹 내 직전슬롯 연속
// 2순위: 선호층 + 주간시간 적은 순
// 3순위: 직전슬롯 연속 (선호층 없는 인원)
// 4순위: 오늘 근무 중 + 주간시간 적은 순
// 5순위: 해당 요일 등교(수업 있음) + 주간시간 적은 순
// 6순위: 주간시간 적은 순 (전체)
function autoSchedule(members, timeSlots, cfg) {
  const schedule = {};
  DAYS.forEach(day => { schedule[day] = timeSlots.map(() => ({ f2: null, f3a: null, f3b: null, f4: null })); });
  const weeklyHours = {}, dailyHours = {};
  members.forEach(m => {
    weeklyHours[m.name] = 0;
    dailyHours[m.name] = {};
    DAYS.forEach(d => { dailyHours[m.name][d] = 0; });
  });
  // 0.5시간 슬롯은 항상 인접 슬롯과 동일 인원 — 배치 후 후처리
  const halfSlotIdx = timeSlots[0]?.hours === 0.5 ? 0 : -1;

  const hasMorningWork = (name, day) =>
    timeSlots.some((slot, pi) => isMorningSlot(slot) && Object.values(schedule[day][pi]).includes(name));
  const hasAfternoonPotential = (name, day, slotH) => {
    const m = members.find(x => x.name === name);
    return m ? timeSlots.some((slot, pi) =>
      isAfternoonSlot(slot) && !isClassTime(m, day, pi, timeSlots) && weeklyHours[name] + slotH <= cfg.maxWeeklyHours
    ) : false;
  };
  const lunchBreakUsed = (name, day, currentSi) => {
    let n = 0;
    timeSlots.forEach((slot, pi) => {
      if (pi < currentSi && isLunchSlot(slot) && !Object.values(schedule[day][pi]).filter(Boolean).includes(name)) n++;
    });
    return n;
  };
  const needsLunchBreak = (name, day, si) => {
    const slot = timeSlots[si];
    if (!isLunchSlot(slot)) return false;
    if (!hasMorningWork(name, day)) return false;
    if (!hasAfternoonPotential(name, day, slot.hours)) return false;
    if (lunchBreakUsed(name, day, si) >= 1) return false;
    return timeSlots.slice(si).filter(isLunchSlot).length <= 1;
  };
  const canAssign = (name, day, si, slotH) => {
    const m = members.find(x => x.name === name);
    if (!m) return false;
    if (isClassTime(m, day, si, timeSlots)) return false;
    if (weeklyHours[name] + slotH > cfg.maxWeeklyHours) return false;
    if (dailyHours[name][day] + slotH > cfg.maxDailyHours) return false;
    if (needsLunchBreak(name, day, si)) return false;
    return true;
  };
  // 점심 보호 완화용: 수업충돌·한도만 체크 (needsLunchBreak 무시)
  const canAssignRelaxed = (name, day, si, slotH) => {
    const m = members.find(x => x.name === name);
    if (!m) return false;
    if (isClassTime(m, day, si, timeSlots)) return false;
    if (weeklyHours[name] + slotH > cfg.maxWeeklyHours) return false;
    if (dailyHours[name][day] + slotH > cfg.maxDailyHours) return false;
    return true;
  };
  const hasClassOnDay = (name, day) => {
    const m = members.find(x => x.name === name);
    return m ? (m.classes || []).some(cls => cls.day === day) : false;
  };

  DAYS.forEach(day => {
    timeSlots.forEach((slot, si) => {
      if (si === halfSlotIdx) return;
      const slotH = slot.hours;
      const alreadyInSlot = () => Object.values(schedule[day][si]).filter(Boolean);

      FLOOR_KEYS.forEach(key => {
        // taken을 매 key마다 재계산해서 앞선 key 배치 결과를 반영
        const taken = alreadyInSlot();
        let available = members.filter(m => !taken.includes(m.name) && canAssign(m.name, day, si, slotH));
        // 점심 보호로 모두 배치 불가 시 완화: 각 층은 항상 1명 배치
        if (available.length === 0)
          available = members.filter(m => !taken.includes(m.name) && canAssignRelaxed(m.name, day, si, slotH));
        if (available.length === 0) return;

        // 0순위: 선호층 + 직전 연속
        if (si > 0) {
          const prev = schedule[day][si - 1][key];
          if (prev && !taken.includes(prev) && canAssign(prev, day, si, slotH) && prefersFloor(members.find(m => m.name === prev), key)) {
            schedule[day][si][key] = prev; weeklyHours[prev] += slotH; dailyHours[prev][day] += slotH; return;
          }
        }

        const preferred = available.filter(m => prefersFloor(m, key));
        if (preferred.length > 0) {
          // 1순위: 선호층 + 직전 연속
          if (si > 0) {
            const prev = schedule[day][si - 1][key];
            const cont = preferred.find(m => m.name === prev);
            if (cont) { schedule[day][si][key] = cont.name; weeklyHours[cont.name] += slotH; dailyHours[cont.name][day] += slotH; return; }
          }
          // 2순위: 선호층 + 주간시간 적은 순
          preferred.sort((a, b) => weeklyHours[a.name] - weeklyHours[b.name]);
          schedule[day][si][key] = preferred[0].name; weeklyHours[preferred[0].name] += slotH; dailyHours[preferred[0].name][day] += slotH; return;
        }

        // 3순위: 직전 연속
        if (si > 0) {
          const prev = schedule[day][si - 1][key];
          if (prev && !taken.includes(prev) && canAssign(prev, day, si, slotH)) {
            schedule[day][si][key] = prev; weeklyHours[prev] += slotH; dailyHours[prev][day] += slotH; return;
          }
        }

        const workingToday = new Set(timeSlots.slice(0, si).flatMap((_, pi) => Object.values(schedule[day][pi])).filter(Boolean));
        // 4순위: 오늘 근무 중 + 주간시간
        const todayWorking = available.filter(m => workingToday.has(m.name)).sort((a, b) => weeklyHours[a.name] - weeklyHours[b.name]);
        if (todayWorking.length > 0) { schedule[day][si][key] = todayWorking[0].name; weeklyHours[todayWorking[0].name] += slotH; dailyHours[todayWorking[0].name][day] += slotH; return; }

        // 5순위: 해당 요일 등교 중(수업 있음) + 주간시간
        const classToday = available.filter(m => hasClassOnDay(m.name, day)).sort((a, b) => weeklyHours[a.name] - weeklyHours[b.name]);
        if (classToday.length > 0) { schedule[day][si][key] = classToday[0].name; weeklyHours[classToday[0].name] += slotH; dailyHours[classToday[0].name][day] += slotH; return; }

        // 6순위: 주간시간 적은 순
        available.sort((a, b) => weeklyHours[a.name] - weeklyHours[b.name]);
        schedule[day][si][key] = available[0].name; weeklyHours[available[0].name] += slotH; dailyHours[available[0].name][day] += slotH;
      });

      // 0.5시간 첫 슬롯 즉시 처리: si=1 배치 직후 si=0 복사 및 시간 반영
      // (후처리가 아닌 즉시 반영해야 이후 슬롯 한도 체크에 정확히 포함됨)
      if (si === 1 && halfSlotIdx === 0 && timeSlots.length > 1) {
        FLOOR_KEYS.forEach(fk => {
          const nextName = schedule[day][1][fk];
          schedule[day][0][fk] = nextName;
          if (nextName) {
            weeklyHours[nextName] += timeSlots[0].hours;
            dailyHours[nextName][day] += timeSlots[0].hours;
          }
        });
      }
    });
  });
  return schedule;
}

// ─── 엑셀 출력 ───────────────────────────────────────────────────────────────
function exportToExcel(schedule, members, timeSlots, cfg) {
  const wb = XLSX.utils.book_new();

  // 시트1: 근무시간표
  const ws_data = [];
  const h1 = ["시간"]; DAYS.forEach(d => h1.push(d, "", "", "")); ws_data.push(h1);
  const h2 = [""]; DAYS.forEach(() => h2.push("2층","3층","3층","4층")); ws_data.push(h2);
  timeSlots.forEach((slot, si) => {
    const row = [slot.label.replace("\n", " ")];
    DAYS.forEach(day => FLOOR_KEYS.forEach(fk => row.push(schedule[day]?.[si]?.[fk] || "")));
    ws_data.push(row);
  });
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  ws["!cols"] = [{ wch: 20 }, ...Array(DAYS.length * 4).fill({ wch: 9 })];
  ws["!merges"] = DAYS.map((_, di) => ({ s: { r: 0, c: 1 + di * 4 }, e: { r: 0, c: 1 + di * 4 + 3 } }));
  XLSX.utils.book_append_sheet(wb, ws, "근무시간표");

  // 시트2: 장학생 명단
  const ws_roster = [["연번","구분","학과","학번","이름","연락처","비고"]];
  members.forEach((m, i) => ws_roster.push([i + 1, "도서관", m.dept||"", m.studentId||"", m.name, m.phone||"", m.note||""]));
  const wsR = XLSX.utils.aoa_to_sheet(ws_roster);
  wsR["!cols"] = [{ wch: 6 },{ wch: 8 },{ wch: 22 },{ wch: 10 },{ wch: 8 },{ wch: 14 },{ wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsR, "장학생명단");

  // 시트3: 주간요약
  const ws_sum = [["이름","학과","학번","주간 근로시간","주간 한도","잔여","일일 한도"]];
  members.forEach(m => {
    let total = 0;
    DAYS.forEach(day => timeSlots.forEach((slot, si) => FLOOR_KEYS.forEach(fk => { if (schedule[day]?.[si]?.[fk] === m.name) total += slot.hours; })));
    ws_sum.push([m.name, m.dept||"", m.studentId||"", total, cfg.maxWeeklyHours, cfg.maxWeeklyHours - total, cfg.maxDailyHours]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(ws_sum);
  ws2["!cols"] = [{ wch: 8 },{ wch: 20 },{ wch: 10 },{ wch: 12 },{ wch: 8 },{ wch: 8 },{ wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws2, "주간요약");

  // 시트4: 운영설정
  const ws_cfg = XLSX.utils.aoa_to_sheet([
    ["항목","값"],
    ["개관 시각", `${cfg.openHour}:${String(cfg.openMin).padStart(2,"0")}`],
    ["폐관 시각", `${cfg.closeHour}:${String(cfg.closeMin).padStart(2,"0")}`],
    ["첫 슬롯(분)", cfg.firstSlotMins],
    ["기본 슬롯(분)", cfg.slotMins],
    ["주간 최대 시간", cfg.maxWeeklyHours],
    ["일일 최대 시간", cfg.maxDailyHours],
  ]);
  ws_cfg["!cols"] = [{ wch: 14 },{ wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws_cfg, "운영설정");

  XLSX.writeFile(wb, "도서관_근로시간표.xlsx");
}

// ─── 대체인원 툴팁 ────────────────────────────────────────────────────────────
function SubTooltip({ members, day, si, fk, schedule, mousePos, visible, timeSlots }) {
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
  const subs           = getAvailableMembers(members, day, si, timeSlots).filter(m => m.name !== currentName);
  const subsFree       = subs.filter(m => !assignedInSlot.includes(m.name));
  const subsAssigned   = subs.filter(m =>  assignedInSlot.includes(m.name));

  return (
    <div ref={tooltipRef} style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }} className="sub-tooltip">
      <div className="sub-tooltip-header">
        <span>🔄 대체 가능 인원</span>
        <span className="sub-slot-info">{day}요일 {timeSlots[si].label.split("\n")[0]} · {FLOOR_LABEL[fk]}</span>
      </div>
      {subs.length === 0 ? <div className="sub-empty">대체 가능 인원 없음</div> : (
        <>
          {subsFree.length > 0 && (
            <div className="sub-section">
              <div className="sub-section-label free">✅ 여유 인원</div>
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
              <div className="sub-section-label busy">⚠️ 타 층 배치 중</div>
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
    </div>
  );
}

// ─── 시간표 셀 ───────────────────────────────────────────────────────────────
function ScheduleCell({ name, day, si, fk, members, schedule, onClick, active, timeSlots, colSpan }) {
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

// ─── Step 0: 운영 설정 ───────────────────────────────────────────────────────
function OperationSetup({ cfg, onNext }) {
  const [preset, setPreset] = useState(null);
  const calcFirstSlot = (openMin) => openMin === 0 ? 60 : 60 - openMin;
  const [localCfg, setLocalCfg] = useState({ ...cfg, slotMins: 60, firstSlotMins: calcFirstSlot(cfg.openMin) });
  const preview = buildTimeSlots(localCfg);
  const update = (field, val) => {
    setPreset(null);
    setLocalCfg(prev => {
      const next = { ...prev, [field]: Number(val) };
      if (field === "openMin") next.firstSlotMins = calcFirstSlot(Number(val));
      return next;
    });
  };
  const applyPreset = key => {
    setPreset(key);
    const p = { ...PRESETS[key], slotMins: 60 };
    p.firstSlotMins = calcFirstSlot(p.openMin);
    setLocalCfg(p);
  };

  return (
    <div className="step-card" style={{ maxWidth: 680 }}>
      <h2 className="step-title">⓪ 운영 설정</h2>
      <div className="preset-row">
        {Object.entries(PRESETS).map(([key, p]) => (
          <button key={key} className={`preset-btn ${preset === key ? "active" : ""}`} onClick={() => applyPreset(key)}>{p.label}</button>
        ))}
        {!preset && <span className="preset-custom-tag">✏️ 커스텀</span>}
      </div>
      <div className="cfg-grid">
        <div className="cfg-section">
          <div className="cfg-section-title">🕐 운영 시간</div>
          {[
            { label: "개관 시각", fH: "openHour", fM: "openMin" },
            { label: "폐관 시각", fH: "closeHour", fM: "closeMin" },
          ].map(({ label, fH, fM }) => (
            <div key={label} className="cfg-row">
              <label className="cfg-label">{label}</label>
              <div className="cfg-time-inputs">
                <input type="number" className="cfg-num" min={0} max={23} value={localCfg[fH]} onChange={e => update(fH, e.target.value)} />
                <span className="cfg-colon">시</span>
                {[0, 30].map(m => (
                  <button key={m}
                    className={`min-btn ${localCfg[fM] === m ? "active" : ""}`}
                    onClick={() => update(fM, m)}>
                    {String(m).padStart(2, "0")}분
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="cfg-row">
            <label className="cfg-label">첫 슬롯 길이</label>
            <div className="cfg-time-inputs">
              <span className="cfg-colon" style={{ fontWeight: 700 }}>{localCfg.firstSlotMins}분</span>
              <span className="cfg-colon" style={{ fontSize: 11, color: "#5a6480" }}>(자동)</span>
            </div>
          </div>
        </div>
        <div className="cfg-section">
          <div className="cfg-section-title">⏱ 근로 한도</div>
          <div className="cfg-row">
            <label className="cfg-label">주간 최대 시간</label>
            <div className="cfg-time-inputs">
              <input type="number" className="cfg-num wide" min={1} max={60} value={localCfg.maxWeeklyHours} onChange={e => update("maxWeeklyHours", e.target.value)} />
              <span className="cfg-colon">시간 / 주</span>
            </div>
          </div>
          <div className="cfg-row">
            <label className="cfg-label">일일 최대 시간</label>
            <div className="cfg-time-inputs">
              <input type="number" className="cfg-num wide" min={1} max={16} value={localCfg.maxDailyHours} onChange={e => update("maxDailyHours", e.target.value)} />
              <span className="cfg-colon">시간 / 일</span>
            </div>
          </div>
          <div className="cfg-summary">
            <div className="cfg-summary-item"><span>총 슬롯 수</span><strong>{preview.length}개</strong></div>
            <div className="cfg-summary-item">
              <span>운영 시간</span>
              <strong>{localCfg.openHour}:{String(localCfg.openMin).padStart(2,"0")} ~ {localCfg.closeHour}:{String(localCfg.closeMin).padStart(2,"0")}</strong>
            </div>
          </div>
        </div>
      </div>
      <div className="preview-section">
        <div className="preview-title">📋 시간 슬롯 미리보기</div>
        <div className="preview-slots">
          {preview.map((s, i) => (
            <div key={i} className="preview-slot">
              <span className="preview-idx">{i + 1}</span>
              <span className="preview-label">{s.label.replace("\n", " ")}</span>
              <span className="preview-hours">{s.hours}h</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
        <button className="btn-next" onClick={() => onNext(localCfg)}>다음: 인원 등록 →</button>
      </div>
    </div>
  );
}

// ─── Step 1: 인원 등록 ───────────────────────────────────────────────────────
function MemberSetup({ members, setMembers, onNext, onBack }) {
  const [form, setForm] = useState({ name: "", ...EMPTY_INFO });
  const [editTarget, setEditTarget] = useState(null);
  const [editInfo, setEditInfo] = useState({ ...EMPTY_INFO, preferFloor: null });
  const upForm = (f, v) => setForm(prev => ({ ...prev, [f]: v }));

  const addMember = () => {
    const n = form.name.trim();
    if (!n || members.find(m => m.name === n)) return;
    setMembers(prev => [...prev, {
      name: n, dept: form.dept.trim(), studentId: form.studentId.trim(),
      phone: form.phone.trim(), note: form.note.trim(),
      color: DEFAULT_COLORS[prev.length % DEFAULT_COLORS.length], classes: [], preferFloor: null,
    }]);
    setForm({ name: "", ...EMPTY_INFO });
  };

  const openEdit = m => {
    setEditTarget(m.name);
    setEditInfo({ dept: m.dept||"", studentId: m.studentId||"", phone: m.phone||"", note: m.note||"", preferFloor: m.preferFloor||null });
  };
  const saveEdit = () => {
    setMembers(prev => prev.map(m => m.name !== editTarget ? m : { ...m, ...editInfo }));
    setEditTarget(null);
  };

  return (
    <div className="step-card" style={{ maxWidth: 820 }}>
      <h2 className="step-title">① 근로자 등록</h2>
      <div className="member-form-grid">
        {[
          { f: "name",      label: "이름*",   ph: "이름",          cls: "mf-name", required: true },
          { f: "dept",      label: "학과",    ph: "학과명",         cls: "mf-wide" },
          { f: "studentId", label: "학번",    ph: "학번",           cls: "mf-mid" },
          { f: "phone",     label: "연락처",   ph: "010-0000-0000", cls: "mf-phone" },
          { f: "note",      label: "비고",    ph: "특이사항",        cls: "mf-wide" },
        ].map(({ f, label, ph, cls }) => (
          <div key={f} className="mf-row">
            <label className="mf-label">{label}</label>
            <input className={`text-input ${cls}`} placeholder={ph} value={form[f]}
              onChange={e => upForm(f, e.target.value)}
              onKeyDown={e => f === "name" && e.key === "Enter" && addMember()} />
          </div>
        ))}
        <button className="btn-primary mf-add" onClick={addMember}>추가</button>
      </div>

      {members.length > 0 && (
        <div className="member-pref-table">
          <div className="pref-table-header">
            <span style={{ minWidth: 24, fontSize: 11, color: "#78909c" }}>No</span>
            <span className="pref-col-name">이름</span>
            <span style={{ flex: 1, fontSize: 11, color: "#78909c" }}>학과 / 학번</span>
            <span style={{ minWidth: 110, fontSize: 11, color: "#78909c" }}>연락처</span>
            <span style={{ minWidth: 130, fontSize: 11, color: "#78909c" }}>선호 층</span>
            <span style={{ minWidth: 70, fontSize: 11, color: "#78909c" }}>비고</span>
            <span style={{ minWidth: 28 }} />
          </div>
          {members.map((m, idx) => (
            <div key={m.name} className="pref-table-row" style={{ borderLeft: `3px solid ${m.color}` }}>
              <span style={{ minWidth: 24, fontSize: 12, color: "#546e7a" }}>{idx + 1}</span>
              <span className="pref-col-name" style={{ color: m.color, fontWeight: 700, cursor: "pointer" }}
                title="클릭하여 수정" onClick={() => openEdit(m)}>{m.name}</span>
              <span style={{ flex: 1, fontSize: 11, color: "#607d8b" }}>
                {m.dept || <span style={{ color: "#b0bec5" }}>—</span>}
                {m.studentId && <span style={{ color: "#546e7a", marginLeft: 6 }}>({m.studentId})</span>}
              </span>
              <span style={{ minWidth: 110, fontSize: 11, color: "#607d8b" }}>{m.phone || <span style={{ color: "#b0bec5" }}>—</span>}</span>
              <div style={{ minWidth: 130, display: "flex", gap: 4 }}>
                {FLOOR_OPTIONS.map(floor => (
                  <button key={floor}
                    className={"pref-floor-btn" + (m.preferFloor === floor ? " selected" : "")}
                    style={m.preferFloor === floor ? { borderColor: m.color, color: m.color, background: m.color + "22" } : {}}
                    onClick={() => setMembers(prev => prev.map(x => x.name !== m.name ? x : { ...x, preferFloor: x.preferFloor === floor ? null : floor }))}>
                    {m.preferFloor === floor && "✓ "}{floor}
                  </button>
                ))}
              </div>
              <span style={{ minWidth: 70, fontSize: 11, color: "#607d8b", overflow: "hidden", textOverflow: "ellipsis" }}>{m.note || ""}</span>
              <button className="remove-btn" onClick={() => setMembers(prev => prev.filter(x => x.name !== m.name))}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* 편집 팝업 */}
      {editTarget && (
        <div className="cell-popup-overlay" onClick={() => setEditTarget(null)}>
          <div className="cell-popup" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <p className="popup-title">
              <span style={{ color: members.find(m => m.name === editTarget)?.color }}>{editTarget}</span> 정보 수정
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { key: "dept",      label: "학과",   ph: "학과명" },
                { key: "studentId", label: "학번",   ph: "학번" },
                { key: "phone",     label: "연락처", ph: "010-0000-0000" },
                { key: "note",      label: "비고",   ph: "특이사항" },
              ].map(({ key, label, ph }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ minWidth: 44, fontSize: 12, color: "#546e7a" }}>{label}</label>
                  <input className="text-input" style={{ flex: 1, padding: "7px 10px", fontSize: 13 }}
                    placeholder={ph} value={editInfo[key]}
                    onChange={e => setEditInfo(prev => ({ ...prev, [key]: e.target.value }))} />
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ minWidth: 44, fontSize: 12, color: "#546e7a" }}>선호 층</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {FLOOR_OPTIONS.map(floor => {
                    const color = members.find(m => m.name === editTarget)?.color || "#1976d2";
                    const sel = editInfo.preferFloor === floor;
                    return (
                      <button key={floor} className={"pref-floor-btn" + (sel ? " selected" : "")}
                        style={sel ? { borderColor: color, color, background: color + "22" } : {}}
                        onClick={() => setEditInfo(prev => ({ ...prev, preferFloor: prev.preferFloor === floor ? null : floor }))}>
                        {sel && "✓ "}{floor}
                      </button>
                    );
                  })}
                  {editInfo.preferFloor && (
                    <button className="pref-floor-btn" style={{ borderColor: "#444", color: "#666", fontSize: 11 }}
                      onClick={() => setEditInfo(prev => ({ ...prev, preferFloor: null }))}>해제</button>
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="btn-back" style={{ padding: "8px 16px" }} onClick={() => setEditTarget(null)}>취소</button>
              <button className="btn-primary" style={{ padding: "8px 20px" }} onClick={saveEdit}>저장</button>
            </div>
          </div>
        </div>
      )}

      <div className="nav-row">
        <button className="btn-back" onClick={onBack}>← 뒤로</button>
        {members.length > 0 && <button className="btn-next" onClick={onNext}>다음: 수업시간 입력 →</button>}
      </div>
    </div>
  );
}

// ─── Step 2: 수업시간 입력 ───────────────────────────────────────────────────
function ClassSetup({ members, setMembers, onNext, onBack }) {
  const [selected, setSelected] = useState(members[0]?.name || "");
  const member = members.find(m => m.name === selected);

  const addClass    = () => setMembers(prev => prev.map(m => m.name !== selected ? m : { ...m, classes: [...(m.classes || []), { day: "월", startHour: 9, startMin: 0, endHour: 10, endMin: 0 }] }));
  const updateClass = (idx, field, value) => setMembers(prev => prev.map(m => m.name !== selected ? m : { ...m, classes: (m.classes || []).map((c, i) => i !== idx ? c : { ...c, [field]: field === "day" ? value : (parseInt(value) || 0) }) }));
  const removeClass = idx => setMembers(prev => prev.map(m => m.name !== selected ? m : { ...m, classes: (m.classes || []).filter((_, i) => i !== idx) }));

  return (
    <div className="step-card">
      <h2 className="step-title">② 수업시간 입력</h2>
      <p className="step-desc">수업 시간은 자동 배치 제외 및 대체 인원 계산에 사용됩니다.</p>
      <div className="tab-row">
        {members.map(m => (
          <button key={m.name} className={`tab-btn ${selected === m.name ? "active" : ""}`}
            style={selected === m.name ? { borderBottom: `3px solid ${m.color}`, color: m.color } : {}}
            onClick={() => setSelected(m.name)}>{m.name}</button>
        ))}
      </div>
      {member && (
        <div className="class-list">
          {(member.classes || []).length === 0 && <p className="no-class">등록된 수업이 없습니다.</p>}
          {(member.classes || []).map((cls, idx) => (
            <div key={idx} className="class-row">
              <select className="sel" value={cls.day} onChange={e => updateClass(idx, "day", e.target.value)}>
                {DAYS_KR.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input type="number" className="time-inp" min={6} max={23} value={cls.startHour} onChange={e => updateClass(idx, "startHour", e.target.value)} />
              <span className="time-sep">:</span>
              <input type="number" className="time-inp" min={0} max={59} step={10} value={cls.startMin} onChange={e => updateClass(idx, "startMin", e.target.value)} />
              <span className="time-sep">~</span>
              <input type="number" className="time-inp" min={6} max={23} value={cls.endHour} onChange={e => updateClass(idx, "endHour", e.target.value)} />
              <span className="time-sep">:</span>
              <input type="number" className="time-inp" min={0} max={59} step={10} value={cls.endMin} onChange={e => updateClass(idx, "endMin", e.target.value)} />
              <button className="remove-btn" onClick={() => removeClass(idx)}>✕</button>
            </div>
          ))}
          <button className="btn-add-class" onClick={addClass}>+ 수업 추가</button>
        </div>
      )}
      <div className="nav-row">
        <button className="btn-back" onClick={onBack}>← 뒤로</button>
        <button className="btn-next" onClick={onNext}>시간표 생성 →</button>
      </div>
    </div>
  );
}

// ─── Step 3: 시간표 편집 ─────────────────────────────────────────────────────
function ScheduleEditor({ members, schedule, setSchedule, onExport, onBack, timeSlots, cfg }) {
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
                    <ScheduleCell key={`${day}-f2`} fk="f2" name={schedule[day]?.[si]?.f2 || ""} day={day} si={si} members={members} schedule={schedule} timeSlots={timeSlots} active={editCell?.day === day && editCell?.si === si && editCell?.fk === "f2"} onClick={() => setEditCell({ day, si, fk: "f2" })} />,
                    <ScheduleCell key={`${day}-f3a`} fk="f3a" name={schedule[day]?.[si]?.f3a || ""} colSpan={merge3 ? 2 : 1} day={day} si={si} members={members} schedule={schedule} timeSlots={timeSlots} active={editCell?.day === day && editCell?.si === si && editCell?.fk === "f3a"} onClick={() => setEditCell({ day, si, fk: "f3a" })} />,
                    ...(merge3 ? [] : [<ScheduleCell key={`${day}-f3b`} fk="f3b" name={schedule[day]?.[si]?.f3b || ""} day={day} si={si} members={members} schedule={schedule} timeSlots={timeSlots} active={editCell?.day === day && editCell?.si === si && editCell?.fk === "f3b"} onClick={() => setEditCell({ day, si, fk: "f3b" })} />]),
                    <ScheduleCell key={`${day}-f4`} fk="f4" name={schedule[day]?.[si]?.f4 || ""} day={day} si={si} members={members} schedule={schedule} timeSlots={timeSlots} active={editCell?.day === day && editCell?.si === si && editCell?.fk === "f4"} onClick={() => setEditCell({ day, si, fk: "f4" })} />,
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

// ─── 메인 앱 ─────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep]         = useState(0);
  const [cfg, setCfg]           = useState({ ...PRESETS.semester });
  const [members, setMembers]   = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [timeSlots, setTimeSlots] = useState(() => buildTimeSlots(PRESETS.semester));

  // Firebase 저장 상태
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const [loadStatus, setLoadStatus] = useState("loading"); // loading | done | error
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const loadedRef = useRef(false); // 로드 완료 여부 — 의존성 배열 오염 없이 체크

  // ── 최초 로드: Firebase에서 불러오기 ──────────────────────────────────────
  useEffect(() => {
    loadFromFirebase().then(data => {
      if (data) {
        if (data.cfg)      { setCfg(data.cfg); setTimeSlots(buildTimeSlots(data.cfg)); }
        if (data.members)  setMembers(data.members);
        // Firebase는 배열을 객체로 저장하므로 schedule 복원 시 배열로 변환
        if (data.schedule) {
          const restored = {};
          DAYS.forEach(day => {
            restored[day] = Array.isArray(data.schedule[day])
              ? data.schedule[day]
              : Object.values(data.schedule[day] || {});
          });
          setSchedule(restored);
        }
        // step은 복원하지 않음 — 항상 ⓪ 운영 설정부터 시작
      }
      loadedRef.current = true;
      setLoadStatus("done");
    }).catch(() => setLoadStatus("error"));
  }, []);

  // ── 변경마다 Firebase에 자동 저장 (step 저장 안 함)
  useEffect(() => {
    if (!loadedRef.current) return; // 초기 로드 전엔 저장 안 함
    setSaveStatus("saving");
    const t = setTimeout(() => {
      saveToFirebase({ cfg, members, schedule }).then(ok => {
        setSaveStatus(ok ? "saved" : "error");
        setTimeout(() => setSaveStatus("idle"), 2000);
      });
    }, 800);
    return () => clearTimeout(t);
  }, [cfg, members, schedule]);

  const handleCfgNext = newCfg => {
    setCfg(newCfg);
    setTimeSlots(buildTimeSlots(newCfg));
    setStep(1);
  };

  const handleGenerate = () => {
    const ts = buildTimeSlots(cfg);
    setTimeSlots(ts);
    setSchedule(autoSchedule(members, ts, cfg));
    setStep(3);
  };

  const handleReset = () => {
    setCfg({ ...PRESETS.semester });
    setMembers([]);
    setSchedule(null);
    setTimeSlots(buildTimeSlots(PRESETS.semester));
    setStep(0);
    setShowResetConfirm(false);
    saveToFirebase({ cfg: PRESETS.semester, members: [], schedule: null });
  };

  const STEP_LABELS = ["운영 설정", "인원 등록", "수업 입력", "시간표"];

  if (loadStatus === "loading") return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#e8f4fd", color: "#1976d2", fontSize: 16, fontFamily: "Noto Sans KR, sans-serif" }}>
      불러오는 중...
    </div>
  );

  if (loadStatus === "error") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#e8f4fd", color: "#e06c75", fontSize: 15, fontFamily: "Noto Sans KR, sans-serif", gap: 16 }}>
      <span>⚠️ Firebase 연결에 실패했습니다.</span>
      <span style={{ fontSize: 12, color: "#607d8b" }}>firebaseConfig 설정값을 확인하거나 네트워크 상태를 확인해주세요.</span>
      <button onClick={() => window.location.reload()} style={{ marginTop: 8, background: "#1976d2", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 13, cursor: "pointer" }}>
        새로고침
      </button>
    </div>
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-accent" />
        <div className="header-top">
          <h1 className="app-title">도서관 근로장학생 <span>시간표 생성기</span></h1>
          <div className="header-actions">
            <span className={`save-indicator ${saveStatus === "saving" ? "saving" : saveStatus === "saved" ? "flash" : saveStatus === "error" ? "error" : ""}`}>
              {saveStatus === "saving" ? "저장 중..." : saveStatus === "error" ? "⚠️ 저장 실패" : "💾 저장됨"}
            </span>
            <button className="btn-reset" onClick={() => setShowResetConfirm(true)}>🗑 초기화</button>
          </div>
        </div>
        <div className="step-indicator">
          {STEP_LABELS.map((s, i) => (
            <div key={i} className={`step-dot ${step === i ? "current" : step > i ? "done" : ""}`}
              style={{ cursor: step > i ? "pointer" : "default" }}
              onClick={() => step > i && setStep(i)}>
              <span>{i === 0 ? "⓪" : i}</span>
              <label>{s}</label>
            </div>
          ))}
        </div>
      </header>

      <main className="app-main">
        {step === 0 && <OperationSetup cfg={cfg} onNext={handleCfgNext} />}
        {step === 1 && <MemberSetup members={members} setMembers={setMembers} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <ClassSetup  members={members} setMembers={setMembers} onNext={handleGenerate} onBack={() => setStep(1)} />}
        {step === 3 && schedule && (
          <ScheduleEditor members={members} schedule={schedule} setSchedule={setSchedule}
            onExport={() => exportToExcel(schedule, members, timeSlots, cfg)}
            onBack={() => setStep(2)} timeSlots={timeSlots} cfg={cfg} />
        )}
      </main>

      {showResetConfirm && (
        <div className="cell-popup-overlay" onClick={() => setShowResetConfirm(false)}>
          <div className="cell-popup" onClick={e => e.stopPropagation()} style={{ maxWidth: 320, textAlign: "center" }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#e06c75", marginBottom: 8 }}>⚠️ 초기화</p>
            <p className="popup-title" style={{ marginBottom: 20 }}>저장된 모든 데이터가 삭제됩니다.<br />계속하시겠습니까?</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button className="btn-back" onClick={() => setShowResetConfirm(false)}>취소</button>
              <button style={{ background: "#e06c75", color: "#fff", border: "none", borderRadius: 10, padding: "11px 24px", fontSize: 13, fontWeight: 700, cursor: "pointer" }} onClick={handleReset}>초기화</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .app { min-height: 100vh; background: #e8f4fd; color: #1a2a3a; font-family: 'Noto Sans KR', sans-serif; }
        .app-header { position: relative; padding: 22px 44px 18px; background: #1565c0; border-bottom: none; overflow: hidden; }
        .header-accent { position: absolute; top: -60px; left: -60px; width: 280px; height: 280px; background: radial-gradient(circle, #ffffff25 0%, transparent 70%); pointer-events: none; }
        .header-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; flex-wrap: wrap; gap: 8px; }
        .app-title { font-size: 16px; font-weight: 700; color: #ffffffaa; }
        .app-title span { color: #7dd3fc; font-size: 22px; font-weight: 900; }
        .header-actions { display: flex; align-items: center; gap: 12px; }
        .save-indicator { font-size: 12px; color: #ffffff50; transition: color .4s; }
        .save-indicator.saving { color: #fde68a; }
        .save-indicator.flash  { color: #7dd3fc; }
        .save-indicator.error  { color: #fca5a5; }
        .btn-reset { background: none; border: 1px solid #ffffff40; border-radius: 8px; color: #ffffffaa; padding: 6px 14px; font-size: 13px; font-family: inherit; cursor: pointer; transition: all .2s; }
        .btn-reset:hover { border-color: #fca5a5; color: #fca5a5; }
        .step-indicator { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
        .step-dot { display: flex; align-items: center; gap: 8px; opacity: .4; transition: opacity .3s; }
        .step-dot.current, .step-dot.done { opacity: 1; }
        .step-dot span { width: 26px; height: 26px; border-radius: 50%; background: #1976d280; border: 2px solid #64b5f6; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #fff; }
        .step-dot.current span { border-color: #fff; background: #ffffff25; }
        .step-dot.done span { background: #7dd3fc; border-color: #7dd3fc; color: #1565c0; }
        .step-dot label { font-size: 13px; font-weight: 500; color: #ffffffcc; cursor: default; }
        .app-main { padding: 32px 20px; display: flex; justify-content: center; }
        .step-card { background: #ffffff; border: 1px solid #bae0f7; border-radius: 18px; padding: 32px; width: 100%; max-width: 640px; box-shadow: 0 4px 24px #0ea5e920; }
        .step-card.wide { max-width: calc(100vw - 40px); }
        .step-title { font-size: 18px; font-weight: 700; color: #1565c0; border-left: 4px solid #29b6f6; padding-left: 12px; margin-bottom: 20px; }
        .step-desc { font-size: 13px; color: #607d8b; margin-bottom: 14px; margin-top: -10px; }
        .preset-row { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; flex-wrap: wrap; }
        .preset-btn { background: #e3f2fd; border: 1px solid #90caf9; border-radius: 10px; color: #1565c0; padding: 8px 22px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all .2s; }
        .preset-btn.active { background: #1976d220; border-color: #1976d2; color: #1976d2; }
        .preset-btn:hover { border-color: #1976d2; }
        .preset-custom-tag { font-size: 13px; color: #f59e0b; font-weight: 600; }
        .cfg-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 20px; }
        @media (max-width: 600px) { .cfg-grid { grid-template-columns: 1fr; } }
        .cfg-section { background: #e3f2fd; border-radius: 12px; padding: 16px 18px; }
        .cfg-section-title { font-size: 13px; font-weight: 700; color: #1976d2; margin-bottom: 14px; }
        .cfg-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .cfg-label { font-size: 13px; color: #455a64; }
        .cfg-time-inputs { display: flex; align-items: center; gap: 6px; }
        .cfg-num { background: #fff; border: 1px solid #90caf9; border-radius: 8px; color: #1a2a3a; padding: 6px 8px; font-size: 14px; font-family: inherit; outline: none; width: 54px; text-align: center; }
        .cfg-num.wide { width: 66px; }
        .cfg-num:focus { border-color: #1976d2; }
        .min-btn { background: #fff; border: 1px solid #90caf9; border-radius: 8px; color: #1565c0; padding: 6px 14px; font-size: 14px; font-family: inherit; cursor: pointer; transition: all .2s; }
        .min-btn.active { background: #1976d220; border-color: #1976d2; color: #1976d2; font-weight: 700; }
        .min-btn:hover { border-color: #1976d2; }
        .cfg-colon { font-size: 13px; color: #78909c; }
        .cfg-summary { margin-top: 16px; padding-top: 14px; border-top: 1px solid #b3d9f5; display: flex; flex-direction: column; gap: 8px; }
        .cfg-summary-item { display: flex; justify-content: space-between; font-size: 13px; }
        .cfg-summary-item span { color: #607d8b; } .cfg-summary-item strong { color: #1565c0; }
        .preview-section { background: #e3f2fd; border-radius: 12px; padding: 16px 18px; }
        .preview-title { font-size: 13px; font-weight: 700; color: #1976d2; margin-bottom: 12px; }
        .preview-slots { display: flex; flex-wrap: wrap; gap: 7px; max-height: 180px; overflow-y: auto; }
        .preview-slot { display: flex; align-items: center; gap: 7px; background: #fff; border: 1px solid #b3d9f5; border-radius: 8px; padding: 5px 12px; }
        .preview-idx { font-size: 11px; color: #90a4ae; min-width: 16px; }
        .preview-label { font-size: 12px; color: #37474f; }
        .preview-hours { font-size: 11px; color: #1976d2; font-weight: 700; }
        .member-form-grid { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; margin-bottom: 20px; background: #e3f2fd; border-radius: 12px; padding: 16px 18px; }
        .mf-row { display: flex; flex-direction: column; gap: 5px; }
        .mf-label { font-size: 12px; color: #546e7a; font-weight: 600; }
        .mf-name { width: 100px !important; } .mf-mid { width: 130px !important; } .mf-phone { width: 180px !important; } .mf-wide { width: 200px !important; }
        .mf-add { align-self: flex-end; padding: 10px 22px !important; }
        .input-row { display: flex; gap: 10px; margin-bottom: 16px; }
        .text-input { flex: 1; background: #fff; border: 1px solid #90caf9; border-radius: 10px; padding: 10px 14px; color: #1a2a3a; font-size: 15px; font-family: inherit; outline: none; transition: border .2s; }
        .text-input:focus { border-color: #1976d2; }
        .btn-primary { background: #1976d2; color: #fff; border: none; border-radius: 10px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .btn-primary:hover { background: #1565c0; }
        .member-pref-table { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
        .pref-table-header { display: flex; align-items: center; gap: 14px; padding: 0 12px 8px; border-bottom: 1px solid #b3d9f5; }
        .pref-col-name { min-width: 70px; font-size: 12px; color: #78909c; font-weight: 600; }
        .pref-table-row { display: flex; align-items: center; gap: 14px; background: #e3f2fd; border-radius: 10px; padding: 10px 14px; }
        .pref-floor-btn { background: #fff; border: 1px solid #90caf9; border-radius: 8px; color: #546e7a; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all .18s; }
        .pref-floor-btn:hover { border-color: #1976d2; color: #1565c0; }
        .pref-floor-btn.selected { font-weight: 700; }
        .remove-btn { background: none; border: none; color: #90a4ae; cursor: pointer; font-size: 13px; padding: 0 2px; transition: color .2s; margin-left: auto; flex-shrink: 0; }
        .remove-btn:hover { color: #ef5350; }
        .btn-next { background: linear-gradient(135deg, #1976d2, #29b6f6); color: #fff; border: none; border-radius: 12px; padding: 12px 30px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: 0 2px 10px #1976d240; }
        .btn-next:hover { opacity: .9; }
        .btn-back { background: #e3f2fd; color: #546e7a; border: 1px solid #90caf9; border-radius: 12px; padding: 12px 20px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .btn-back:hover { border-color: #1976d2; color: #1565c0; }
        .btn-export { background: linear-gradient(135deg, #2e7d32, #43a047); color: #fff; border: none; border-radius: 12px; padding: 12px 30px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: 0 2px 10px #2e7d3240; }
        .btn-export:hover { opacity: .9; }
        .nav-row { display: flex; justify-content: space-between; align-items: center; margin-top: 24px; }
        .tab-row { display: flex; gap: 4px; margin-bottom: 18px; flex-wrap: wrap; }
        .tab-btn { background: none; border: none; border-bottom: 3px solid transparent; padding: 8px 14px; font-size: 14px; font-family: inherit; color: #90a4ae; cursor: pointer; transition: color .2s; }
        .tab-btn.active { color: #1976d2; }
        .class-list { margin-bottom: 14px; }
        .no-class { font-size: 13px; color: #90a4ae; margin-bottom: 12px; }
        .class-row { display: flex; align-items: center; gap: 7px; margin-bottom: 9px; flex-wrap: wrap; }
        .sel, .time-inp { background: #fff; border: 1px solid #90caf9; border-radius: 8px; color: #1a2a3a; padding: 7px 9px; font-size: 13px; font-family: inherit; outline: none; }
        .sel { min-width: 60px; } .time-inp { width: 54px; text-align: center; } .time-sep { color: #90a4ae; font-size: 14px; }
        .btn-add-class { background: #e3f2fd; color: #1976d2; border: 1px dashed #90caf9; border-radius: 10px; padding: 8px 16px; font-size: 13px; font-family: inherit; cursor: pointer; margin-top: 4px; }
        .btn-add-class:hover { border-color: #1976d2; }
        .editor-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; flex-wrap: wrap; gap: 8px; }
        .cfg-badge { font-size: 12px; color: #546e7a; background: #e3f2fd; border: 1px solid #90caf9; border-radius: 8px; padding: 6px 12px; }
        .hover-hint { font-size: 12px; color: #607d8b; background: #e3f2fd; border: 1px solid #90caf9; border-radius: 8px; padding: 6px 12px; }
        .weekly-bar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; background: #e3f2fd; border-radius: 12px; padding: 14px 16px; }
        .weekly-item { display: flex; align-items: center; gap: 8px; min-width: 180px; flex: 1; }
        .weekly-name { font-size: 13px; font-weight: 700; min-width: 52px; color: #1a2a3a; }
        .weekly-track { flex: 1; height: 6px; background: #b3d9f5; border-radius: 3px; overflow: hidden; }
        .weekly-fill { height: 100%; border-radius: 3px; transition: width .4s ease; }
        .weekly-h { font-size: 12px; color: #546e7a; min-width: 62px; text-align: right; }
        .weekly-h.over { color: #ef5350; font-weight: 700; }
        .table-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid #bae0f7; }
        .sched-table { border-collapse: collapse; width: 100%; font-size: 13px; table-layout: fixed; }
        .sched-table th, .sched-table td { border: 1px solid #bae0f7; text-align: center; padding: 6px 4px; white-space: pre-line; }
        .th-time { background: #e3f2fd; color: #78909c; font-weight: 600; width: 96px; font-size: 12px; }
        .th-day { background: #1976d2; color: #fff; font-weight: 700; font-size: 14px; }
        .th-floor { background: #bbdefb; color: #1565c0; font-weight: 600; font-size: 11px; }
        .td-time { background: #e3f2fd; color: #78909c; font-size: 11px; font-weight: 500; width: 96px; line-height: 1.5; }
        .td-cell { cursor: pointer; font-size: 13px; position: relative; }
        .td-cell::after { content: ''; position: absolute; inset: 0; background: transparent; pointer-events: none; transition: background .15s; }
        .td-cell:hover::after { background: rgba(0,0,0,0.07); }
        .active-cell { outline: 2px solid #1976d2; outline-offset: -2px; }
        .empty-cell { color: #cfd8dc; }

        .cell-popup-overlay { position: fixed; inset: 0; background: #00000060; display: flex; align-items: center; justify-content: center; z-index: 200; }
        .cell-popup { background: #fff; border: 1px solid #90caf9; border-radius: 16px; padding: 24px; min-width: 260px; max-width: 380px; box-shadow: 0 8px 32px #1976d230; }
        .popup-title { font-size: 14px; color: #546e7a; margin-bottom: 16px; font-weight: 500; line-height: 1.6; }
        .popup-members { display: flex; flex-wrap: wrap; gap: 8px; }
        .popup-member-btn { background: none; border: 2px solid; border-radius: 10px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background .15s; position: relative; }
        .popup-member-btn:hover:not(.has-class) { background: #00000010; }
        .popup-member-btn.has-class { cursor: not-allowed; }
        .class-badge { position: absolute; top: -7px; right: -5px; background: #ef5350; color: #fff; font-size: 9px; font-weight: 700; border-radius: 4px; padding: 1px 4px; }
        .clear-btn { border-color: #90caf9 !important; color: #90a4ae !important; }
        .sub-tooltip { background: #fff; border: 1px solid #90caf9; border-radius: 14px; padding: 13px 15px; min-width: 200px; max-width: 280px; box-shadow: 0 8px 32px #1976d230; pointer-events: none; animation: tipIn .12s ease; }
        @keyframes tipIn { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:translateY(0); } }
        .sub-tooltip-header { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; padding-bottom: 9px; border-bottom: 1px solid #b3d9f5; }
        .sub-tooltip-header span:first-child { font-size: 13px; font-weight: 700; color: #1565c0; }
        .sub-slot-info { font-size: 11px; color: #90a4ae; }
        .sub-section { margin-bottom: 8px; } .sub-section:last-child { margin-bottom: 0; }
        .sub-section-label { font-size: 11px; font-weight: 700; margin-bottom: 6px; }
        .sub-section-label.free { color: #0097a7; } .sub-section-label.busy { color: #f59e0b; }
        .sub-chips { display: flex; flex-wrap: wrap; gap: 5px; }
        .sub-chip { display: flex; align-items: center; gap: 6px; background: #e3f2fd; border: 1px solid; border-radius: 8px; padding: 4px 10px; font-size: 12px; }
        .sub-chip-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .sub-empty { font-size: 12px; color: #90a4ae; text-align: center; padding: 6px 0; }
      `}</style>
    </div>
  );
}
