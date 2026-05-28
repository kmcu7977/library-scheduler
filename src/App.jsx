import { useState, useRef, useEffect, useMemo } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get } from "firebase/database";

// xlsx는 index.html CDN으로 로드됩니다 (import 블록 이후 선언)
// eslint-disable-next-line no-undef
const XLSX = window.XLSX;

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  Firebase 설정 — Firebase 콘솔에서 복사해서 교체하세요
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_AUTH_DOMAIN",
  databaseURL:       "https://library-checklist-4ec86-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
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
  } catch (e) { console.error("Firebase 불러오기 실패:", e); return null; }
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
  while (cur + dur <= closeH + 0.001) {
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
// 5순위: 주간시간 적은 순 (전체)
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
  const lunchBreakUsed = (name, day) => {
    let n = 0;
    timeSlots.forEach((slot, pi) => {
      if (isLunchSlot(slot) && !Object.values(schedule[day][pi]).filter(Boolean).includes(name)) n++;
    });
    return n;
  };
  const needsLunchBreak = (name, day, si) => {
    const slot = timeSlots[si];
    if (!isLunchSlot(slot)) return false;
    if (!hasMorningWork(name, day)) return false;
    if (!hasAfternoonPotential(name, day, slot.hours)) return false;
    if (lunchBreakUsed(name, day) >= 1) return false;
    return timeSlots.slice(si).filter(isLunchSlot).length <= 1;
  };
  const canAssign = (name, day, si, slotH) => {
    const m = members.find(x => x.name === name);
    if (!m) return false;
    if (isClassTime(m, day, si, timeSlots)) return false;
    // si=1 배치 시 후처리로 추가될 halfSlot 0.5h를 미리 반영해서 한도 체크
    const halfExtra = (halfSlotIdx === 0 && si === 1) ? timeSlots[0].hours : 0;
    if (weeklyHours[name] + slotH + halfExtra > cfg.maxWeeklyHours) return false;
    if (dailyHours[name][day] + slotH + halfExtra > cfg.maxDailyHours) return false;
    if (needsLunchBreak(name, day, si)) return false;
    return true;
  };

  DAYS.forEach(day => {
    timeSlots.forEach((slot, si) => {
      if (si === halfSlotIdx) return;
      const slotH = slot.hours;
      const alreadyInSlot = () => Object.values(schedule[day][si]).filter(Boolean);

      FLOOR_KEYS.forEach(key => {
        // taken을 매 key마다 재계산해서 앞선 key 배치 결과를 반영
        const taken = alreadyInSlot();
        const available = members.filter(m => !taken.includes(m.name) && canAssign(m.name, day, si, slotH));
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

        // 5순위: 주간시간 적은 순
        available.sort((a, b) => weeklyHours[a.name] - weeklyHours[b.name]);
        schedule[day][si][key] = available[0].name; weeklyHours[available[0].name] += slotH; dailyHours[available[0].name][day] += slotH;
      });
    });
    // 0.5시간 첫 슬롯 후처리: 다음 슬롯(si=1)과 동일 인원으로 무조건 복사
    if (halfSlotIdx === 0 && timeSlots.length > 1) {
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
function SubTooltip({ members, day, si, fk, schedule, anchorRef, visible, timeSlots }) {
  const tooltipRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!visible || !anchorRef.current || !tooltipRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const tip  = tooltipRef.current.getBoundingClientRect();
    let top  = rect.bottom + 4;
    let left = rect.left + rect.width / 2 - tip.width / 2;
    if (rect.bottom + tip.height + 8 > window.innerHeight) top = rect.top - tip.height - 4;
    if (left < 4) left = 4;
    if (left + tip.width > window.innerWidth - 4) left = window.innerWidth - tip.width - 4;
    setPos({ top, left });
  }, [visible, anchorRef]);
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
                  <div key={m.name} className="sub-chip" style={{ borderColor: m.color + "99", opacity: .7 }}>
                    <span className="sub-chip-dot" style={{ background: m.color }} />
                    <span style={{ color: m.color + "aa", fontWeight: 700 }}>{m.name}</span>
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
function ScheduleCell({ name, day, si, fk, members, schedule, onClick, active, timeSlots }) {
  const [hovered, setHovered] = useState(false);
  const cellRef = useRef(null);
  const color = members.find(m => m.name === name)?.color || "#aaa";
  return (
    <td ref={cellRef}
      className={`td-cell ${active ? "active-cell" : ""} ${!name ? "empty-cell" : ""}`}
      style={name ? { background: color + "28", color, fontWeight: 700 } : {}}
      onClick={onClick}
      onMouseEnter={() => name && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {name || "·"}
      {hovered && name && (
        <SubTooltip members={members} day={day} si={si} fk={fk}
          schedule={schedule} anchorRef={cellRef} visible={hovered} timeSlots={timeSlots} />
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
          { f: "phone",     label: "연락처",   ph: "010-0000-0000", cls: "mf-mid" },
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
            <span style={{ minWidth: 24, fontSize: 11, color: "#3a4860" }}>No</span>
            <span className="pref-col-name">이름</span>
            <span style={{ flex: 1, fontSize: 11, color: "#3a4860" }}>학과 / 학번</span>
            <span style={{ minWidth: 110, fontSize: 11, color: "#3a4860" }}>연락처</span>
            <span style={{ minWidth: 130, fontSize: 11, color: "#3a4860" }}>선호 층</span>
            <span style={{ minWidth: 70, fontSize: 11, color: "#3a4860" }}>비고</span>
            <span style={{ minWidth: 28 }} />
          </div>
          {members.map((m, idx) => (
            <div key={m.name} className="pref-table-row" style={{ borderLeft: `3px solid ${m.color}` }}>
              <span style={{ minWidth: 24, fontSize: 12, color: "#4a5878" }}>{idx + 1}</span>
              <span className="pref-col-name" style={{ color: m.color, fontWeight: 700, cursor: "pointer" }}
                title="클릭하여 수정" onClick={() => openEdit(m)}>{m.name}</span>
              <span style={{ flex: 1, fontSize: 11, color: "#7080a0" }}>
                {m.dept || <span style={{ color: "#2a3050" }}>—</span>}
                {m.studentId && <span style={{ color: "#4a5878", marginLeft: 6 }}>({m.studentId})</span>}
              </span>
              <span style={{ minWidth: 110, fontSize: 11, color: "#7080a0" }}>{m.phone || <span style={{ color: "#2a3050" }}>—</span>}</span>
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
              <span style={{ minWidth: 70, fontSize: 11, color: "#e5c07b", overflow: "hidden", textOverflow: "ellipsis" }}>{m.note || ""}</span>
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
                  <label style={{ minWidth: 44, fontSize: 12, color: "#8892b0" }}>{label}</label>
                  <input className="text-input" style={{ flex: 1, padding: "7px 10px", fontSize: 13 }}
                    placeholder={ph} value={editInfo[key]}
                    onChange={e => setEditInfo(prev => ({ ...prev, [key]: e.target.value }))} />
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ minWidth: 44, fontSize: 12, color: "#8892b0" }}>선호 층</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {FLOOR_OPTIONS.map(floor => {
                    const color = members.find(m => m.name === editTarget)?.color || "#4a90d9";
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

  const addClass    = () => setMembers(prev => prev.map(m => m.name !== selected ? m : { ...m, classes: [...m.classes, { day: "월", startHour: 9, startMin: 0, endHour: 10, endMin: 0 }] }));
  const updateClass = (idx, field, value) => setMembers(prev => prev.map(m => m.name !== selected ? m : { ...m, classes: m.classes.map((c, i) => i !== idx ? c : { ...c, [field]: field === "day" ? value : (parseInt(value) || 0) }) }));
  const removeClass = idx => setMembers(prev => prev.map(m => m.name !== selected ? m : { ...m, classes: m.classes.filter((_, i) => i !== idx) }));

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
          {member.classes.length === 0 && <p className="no-class">등록된 수업이 없습니다.</p>}
          {member.classes.map((cls, idx) => (
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
              {DAYS.map(day => ["2층","3층","3층","4층"].map((f, fi) => <th key={`${day}-${fi}`} className="th-floor">{f}</th>))}
            </tr>
          </thead>
          <tbody>
            {timeSlots.map((slot, si) => (
              <tr key={si} className={si === 0 ? "tr-first" : ""}>
                <td className="td-time">{slot.label}</td>
                {DAYS.map(day => FLOOR_KEYS.map(fk => (
                  <ScheduleCell key={`${day}-${fk}`}
                    name={schedule[day]?.[si]?.[fk] || ""} day={day} si={si} fk={fk}
                    members={members} schedule={schedule} timeSlots={timeSlots}
                    active={editCell?.day === day && editCell?.si === si && editCell?.fk === fk}
                    onClick={() => setEditCell({ day, si, fk })} />
                )))}
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
              <span style={{ color: "#4a90d9" }}>{FLOOR_LABEL[editCell.fk]}</span> 담당자 변경
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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0f1117", color: "#4a90d9", fontSize: 16, fontFamily: "Noto Sans KR, sans-serif" }}>
      불러오는 중...
    </div>
  );

  if (loadStatus === "error") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0f1117", color: "#e06c75", fontSize: 15, fontFamily: "Noto Sans KR, sans-serif", gap: 16 }}>
      <span>⚠️ Firebase 연결에 실패했습니다.</span>
      <span style={{ fontSize: 12, color: "#5a6480" }}>firebaseConfig 설정값을 확인하거나 네트워크 상태를 확인해주세요.</span>
      <button onClick={() => window.location.reload()} style={{ marginTop: 8, background: "#4a90d9", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 13, cursor: "pointer" }}>
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
        .app { min-height: 100vh; background: #0f1117; color: #e8eaf0; font-family: 'Noto Sans KR', sans-serif; }
        .app-header { position: relative; padding: 18px 36px 14px; border-bottom: 1px solid #1a1f30; overflow: hidden; }
        .header-accent { position: absolute; top: -60px; left: -60px; width: 280px; height: 280px; background: radial-gradient(circle, #4a90d940 0%, transparent 70%); pointer-events: none; }
        .header-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
        .app-title { font-size: 15px; font-weight: 700; color: #8892b0; }
        .app-title span { color: #4a90d9; font-size: 19px; font-weight: 900; }
        .header-actions { display: flex; align-items: center; gap: 10px; }
        .save-indicator { font-size: 11px; color: #2a3448; transition: color .4s; }
        .save-indicator.saving { color: #e5c07b; }
        .save-indicator.flash  { color: #56b6c2; }
        .save-indicator.error  { color: #e06c75; }
        .btn-reset { background: none; border: 1px solid #222840; border-radius: 8px; color: #3a4868; padding: 5px 12px; font-size: 12px; font-family: inherit; cursor: pointer; transition: all .2s; }
        .btn-reset:hover { border-color: #e06c75; color: #e06c75; }
        .step-indicator { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
        .step-dot { display: flex; align-items: center; gap: 7px; opacity: .3; transition: opacity .3s; }
        .step-dot.current, .step-dot.done { opacity: 1; }
        .step-dot span { width: 22px; height: 22px; border-radius: 50%; background: #1e2130; border: 2px solid #2e3450; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; }
        .step-dot.current span { border-color: #4a90d9; color: #4a90d9; background: #4a90d912; }
        .step-dot.done span { background: #4a90d9; border-color: #4a90d9; color: #fff; }
        .step-dot label { font-size: 12px; font-weight: 500; cursor: default; }
        .app-main { padding: 24px 14px; display: flex; justify-content: center; }
        .step-card { background: #161922; border: 1px solid #1e2540; border-radius: 16px; padding: 26px; width: 100%; max-width: 560px; }
        .step-card.wide { max-width: 1200px; }
        .step-title { font-size: 16px; font-weight: 700; color: #c5cae9; border-left: 3px solid #4a90d9; padding-left: 10px; margin-bottom: 16px; }
        .step-desc { font-size: 12px; color: #5a6480; margin-bottom: 12px; margin-top: -8px; }
        .preset-row { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
        .preset-btn { background: #1a1e2e; border: 1px solid #2a3050; border-radius: 8px; color: #7986cb; padding: 7px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all .2s; }
        .preset-btn.active { background: #4a90d920; border-color: #4a90d9; color: #4a90d9; }
        .preset-custom-tag { font-size: 12px; color: #e5c07b; }
        .cfg-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
        @media (max-width: 560px) { .cfg-grid { grid-template-columns: 1fr; } }
        .cfg-section { background: #1a1e2e; border-radius: 10px; padding: 14px 16px; }
        .cfg-section-title { font-size: 12px; font-weight: 700; color: #7986cb; margin-bottom: 12px; }
        .cfg-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .cfg-label { font-size: 12px; color: #8892b0; }
        .cfg-time-inputs { display: flex; align-items: center; gap: 4px; }
        .cfg-num { background: #12151f; border: 1px solid #2a3050; border-radius: 6px; color: #e8eaf0; padding: 5px 6px; font-size: 13px; font-family: inherit; outline: none; width: 50px; text-align: center; }
        .cfg-num.wide { width: 60px; }
        .cfg-num:focus { border-color: #4a90d9; }
        .min-btn { background: #1a1e2e; border: 1px solid #2a3050; border-radius: 6px; color: #7986cb; padding: 5px 12px; font-size: 13px; font-family: inherit; cursor: pointer; transition: all .2s; }
        .min-btn.active { background: #4a90d920; border-color: #4a90d9; color: #4a90d9; font-weight: 700; }
        .min-btn:hover { border-color: #4a90d9; }
        .cfg-colon { font-size: 12px; color: #555; }
        .cfg-summary { margin-top: 14px; padding-top: 12px; border-top: 1px solid #1e2540; display: flex; flex-direction: column; gap: 6px; }
        .cfg-summary-item { display: flex; justify-content: space-between; font-size: 12px; }
        .cfg-summary-item span { color: #5a6480; } .cfg-summary-item strong { color: #c5cae9; }
        .preview-section { background: #1a1e2e; border-radius: 10px; padding: 14px 16px; }
        .preview-title { font-size: 12px; font-weight: 700; color: #7986cb; margin-bottom: 10px; }
        .preview-slots { display: flex; flex-wrap: wrap; gap: 6px; max-height: 160px; overflow-y: auto; }
        .preview-slot { display: flex; align-items: center; gap: 6px; background: #12151f; border: 1px solid #222840; border-radius: 6px; padding: 4px 10px; }
        .preview-idx { font-size: 10px; color: #4a6090; min-width: 14px; }
        .preview-label { font-size: 11px; color: #8892b0; }
        .preview-hours { font-size: 10px; color: #4a90d9; font-weight: 700; }
        .member-form-grid { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; margin-bottom: 18px; background: #1a1e2e; border-radius: 10px; padding: 14px 16px; }
        .mf-row { display: flex; flex-direction: column; gap: 4px; }
        .mf-label { font-size: 11px; color: #5a6890; font-weight: 600; }
        .mf-name { width: 90px !important; } .mf-mid { width: 120px !important; } .mf-wide { width: 180px !important; }
        .mf-add { align-self: flex-end; padding: 9px 20px !important; }
        .input-row { display: flex; gap: 8px; margin-bottom: 14px; }
        .text-input { flex: 1; background: #1a1e2e; border: 1px solid #2a3050; border-radius: 8px; padding: 9px 13px; color: #e8eaf0; font-size: 14px; font-family: inherit; outline: none; transition: border .2s; }
        .text-input:focus { border-color: #4a90d9; }
        .btn-primary { background: #4a90d9; color: #fff; border: none; border-radius: 8px; padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .member-pref-table { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
        .pref-table-header { display: flex; align-items: center; gap: 12px; padding: 0 10px 6px; border-bottom: 1px solid #1e2540; }
        .pref-col-name { min-width: 64px; font-size: 11px; color: #4a5878; font-weight: 600; }
        .pref-table-row { display: flex; align-items: center; gap: 12px; background: #1a1e2e; border-radius: 8px; padding: 9px 12px; }
        .pref-floor-btn { background: #12151f; border: 1px solid #2a3050; border-radius: 7px; color: #5a6890; padding: 5px 10px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all .18s; }
        .pref-floor-btn:hover { border-color: #4a6090; color: #8892b0; }
        .pref-floor-btn.selected { font-weight: 700; }
        .remove-btn { background: none; border: none; color: #444; cursor: pointer; font-size: 11px; padding: 0 2px; transition: color .2s; margin-left: auto; flex-shrink: 0; }
        .remove-btn:hover { color: #e06c75; }
        .btn-next { background: linear-gradient(135deg, #4a90d9, #6a6fe8); color: #fff; border: none; border-radius: 10px; padding: 11px 26px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
        .btn-next:hover { opacity: .85; }
        .btn-back { background: #1e2540; color: #8892b0; border: none; border-radius: 10px; padding: 11px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .btn-export { background: linear-gradient(135deg, #27ae60, #2ecc71); color: #fff; border: none; border-radius: 10px; padding: 11px 26px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
        .btn-export:hover { opacity: .85; }
        .nav-row { display: flex; justify-content: space-between; align-items: center; margin-top: 20px; }
        .tab-row { display: flex; gap: 4px; margin-bottom: 16px; flex-wrap: wrap; }
        .tab-btn { background: none; border: none; border-bottom: 3px solid transparent; padding: 6px 11px; font-size: 13px; font-family: inherit; color: #444; cursor: pointer; transition: color .2s; }
        .tab-btn.active { color: #4a90d9; }
        .class-list { margin-bottom: 12px; }
        .no-class { font-size: 12px; color: #3a4060; margin-bottom: 10px; }
        .class-row { display: flex; align-items: center; gap: 5px; margin-bottom: 7px; flex-wrap: wrap; }
        .sel, .time-inp { background: #1a1e2e; border: 1px solid #2a3050; border-radius: 6px; color: #e8eaf0; padding: 5px 7px; font-size: 12px; font-family: inherit; outline: none; }
        .sel { min-width: 55px; } .time-inp { width: 48px; text-align: center; } .time-sep { color: #444; font-size: 12px; }
        .btn-add-class { background: #1e2540; color: #4a90d9; border: 1px dashed #4a90d950; border-radius: 8px; padding: 6px 13px; font-size: 12px; font-family: inherit; cursor: pointer; margin-top: 4px; }
        .editor-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
        .cfg-badge { font-size: 11px; color: #5a7090; background: #141820; border: 1px solid #1e2840; border-radius: 7px; padding: 5px 10px; }
        .hover-hint { font-size: 11px; color: #4a5870; background: #141820; border: 1px solid #1e2840; border-radius: 7px; padding: 5px 10px; }
        .weekly-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; background: #1a1e2e; border-radius: 10px; padding: 12px 14px; }
        .weekly-item { display: flex; align-items: center; gap: 7px; min-width: 170px; flex: 1; }
        .weekly-name { font-size: 12px; font-weight: 700; min-width: 48px; }
        .weekly-track { flex: 1; height: 5px; background: #222840; border-radius: 3px; overflow: hidden; }
        .weekly-fill { height: 100%; border-radius: 3px; transition: width .4s ease; }
        .weekly-h { font-size: 11px; color: #5a6480; min-width: 58px; text-align: right; }
        .weekly-h.over { color: #e06c75; font-weight: 700; }
        .table-wrap { overflow-x: auto; border-radius: 10px; border: 1px solid #1e2540; }
        .sched-table { border-collapse: collapse; min-width: 900px; width: 100%; font-size: 12px; }
        .sched-table th, .sched-table td { border: 1px solid #1a2035; text-align: center; padding: 4px 2px; white-space: pre-line; }
        .th-time { background: #141720; color: #6a7490; font-weight: 600; width: 86px; font-size: 10px; }
        .th-day { background: #1c2238; color: #c5cae9; font-weight: 700; font-size: 13px; }
        .th-floor { background: #171b2c; color: #6272a4; font-weight: 600; font-size: 10px; }
        .td-time { background: #111420; color: #6a7490; font-size: 10px; font-weight: 500; width: 86px; line-height: 1.5; }
        .td-cell { cursor: pointer; transition: filter .15s; font-size: 12px; min-width: 50px; position: relative; }
        .td-cell:hover { filter: brightness(1.3); }
        .active-cell { outline: 2px solid #4a90d9; outline-offset: -2px; }
        .empty-cell { color: #1e2540; }
        .tr-first td, .tr-first th { background: #181d2e !important; }
        .cell-popup-overlay { position: fixed; inset: 0; background: #000000a0; display: flex; align-items: center; justify-content: center; z-index: 200; }
        .cell-popup { background: #1a1e2e; border: 1px solid #2a3050; border-radius: 14px; padding: 20px; min-width: 240px; max-width: 360px; }
        .popup-title { font-size: 13px; color: #8892b0; margin-bottom: 14px; font-weight: 500; line-height: 1.6; }
        .popup-members { display: flex; flex-wrap: wrap; gap: 7px; }
        .popup-member-btn { background: none; border: 2px solid; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background .15s; position: relative; }
        .popup-member-btn:hover:not(.has-class) { background: #ffffff12; }
        .popup-member-btn.has-class { cursor: not-allowed; }
        .class-badge { position: absolute; top: -7px; right: -5px; background: #e06c75; color: #fff; font-size: 8px; font-weight: 700; border-radius: 4px; padding: 1px 3px; }
        .clear-btn { border-color: #2a3050 !important; color: #5a6480 !important; }
        .sub-tooltip { background: #0e1018; border: 1px solid #253060; border-radius: 12px; padding: 11px 13px; min-width: 190px; max-width: 270px; box-shadow: 0 8px 32px #000000b0; pointer-events: none; animation: tipIn .12s ease; }
        @keyframes tipIn { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:translateY(0); } }
        .sub-tooltip-header { display: flex; flex-direction: column; gap: 2px; margin-bottom: 9px; padding-bottom: 8px; border-bottom: 1px solid #1a2040; }
        .sub-tooltip-header span:first-child { font-size: 12px; font-weight: 700; color: #c5cae9; }
        .sub-slot-info { font-size: 10px; color: #3a5070; }
        .sub-section { margin-bottom: 7px; } .sub-section:last-child { margin-bottom: 0; }
        .sub-section-label { font-size: 10px; font-weight: 700; margin-bottom: 5px; }
        .sub-section-label.free { color: #56b6c2; } .sub-section-label.busy { color: #e5c07b; }
        .sub-chips { display: flex; flex-wrap: wrap; gap: 4px; }
        .sub-chip { display: flex; align-items: center; gap: 5px; background: #141820; border: 1px solid; border-radius: 6px; padding: 3px 8px; font-size: 11px; }
        .sub-chip-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .sub-empty { font-size: 11px; color: #3a4060; text-align: center; padding: 5px 0; }
      `}</style>
    </div>
  );
}
