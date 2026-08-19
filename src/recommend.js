// 칸 추천 — "이 자리에 누가 맞나"를 근거와 함께 제시한다.
//
// 자동 전체배치(scheduler.js)와 역할이 다르다:
//   scheduler = 판을 대신 짜준다 / recommend = 사서가 짜고 도구는 근거만 댄다
// 그래서 규정을 넘는 사람도 숨기지 않는다. 사유를 붙여 아래로 내릴 뿐,
// 넣을지 말지는 사서가 정한다 (실제 수기 시간표에도 일 8h 초과가 존재함).
//
// 드래그로 여러 요일·여러 층에 걸쳐 고를 수 있으므로 선택은 항상 칸 목록으로 다룬다.
// 고른 칸 전체를 "한 사람이 맡을 근무"로 보고 시간은 합계로, 충돌은 하나라도 걸리면 불가로 판정한다.
import { DAYS, FLOOR_KEYS } from "./constants";
import { isClassTime, floorAllowed, prefersFloor1, prefersFloor2 } from "./utils";

// 근로 유형 = 주당 근무시간. 미설정자는 운영 설정의 기본값을 따른다
const capOf = (m, cfg) => m.weeklyHours ?? cfg.maxWeeklyHours;
const tier = (r) => (r.conflicts.length ? 2 : r.warnings.length ? 1 : 0);
const cellAt = (schedule, day, si, fk) => schedule?.[day]?.[si]?.[fk] || null;
const keyOf = (c) => `${c.day}|${c.si}|${c.fk}`;

/**
 * 한 번에 고른 칸들에 대한 후보 순위.
 * @param cells [{day, si, fk}] — 드래그로 고른 칸 목록 (한 칸이면 길이 1)
 * @returns [{ member, score, why[], conflicts[], warnings[], blocked[], remain, isCurrent }]
 *          conflicts = 배치 불가(수업·중복) / warnings = 규정 초과지만 사서 재량(한도·층) / blocked = 둘의 합
 */
export function recommend(members, schedule, timeSlots, cfg, cells) {
  const picked = new Set(cells.map(keyOf));
  const hours = cells.reduce((a, c) => a + timeSlots[c.si].hours, 0);
  const maxCap = Math.max(...members.map(m => capOf(m, cfg)), 1);

  // 고른 칸을 (요일, 층)별로 묶는다 — 이어서 근무 판정은 같은 열 안에서만 의미가 있다
  const runs = new Map();
  for (const c of cells) {
    const k = `${c.day}|${c.fk}`;
    if (!runs.has(k)) runs.set(k, { day: c.day, fk: c.fk, sis: [] });
    runs.get(k).sis.push(c.si);
  }
  for (const r of runs.values()) r.sis.sort((a, b) => a - b);

  // 요일별 선택 시간 (하루 한도 판정용)
  const pickedByDay = {};
  for (const c of cells) pickedByDay[c.day] = (pickedByDay[c.day] || 0) + timeSlots[c.si].hours;

  // 같은 요일·같은 시각을 두 층 이상 고른 경우 — 한 사람이 동시에 맡을 수 없다.
  // 선택 자체의 성질이라 후보와 무관하지만, 비우기에는 쓸 수 있으므로 막지 않고 사유만 붙인다
  const slotSeen = new Set();
  let overlapping = false;
  for (const c of cells) {
    const k = `${c.day}|${c.si}`;
    if (slotSeen.has(k)) overlapping = true;
    slotSeen.add(k);
  }

  return members.map(m => {
    const cap = capOf(m, cfg);

    // 이미 배정된 시간 — 지금 고른 칸은 덮어쓸 것이므로 뺀다
    let week = 0;
    const byDay = {};
    for (const d of DAYS) {
      for (let si = 0; si < timeSlots.length; si++) {
        for (const fk of FLOOR_KEYS) {
          if (picked.has(`${d}|${si}|${fk}`)) continue;
          if (cellAt(schedule, d, si, fk) !== m.name) continue;
          week += timeSlots[si].hours;
          byDay[d] = (byDay[d] || 0) + timeSlots[si].hours;
        }
      }
    }

    // 애초에 몸이 둘이 아니라 불가능한 것 — 넣지 못하게 막는다
    const conflicts = [];
    if (cells.some(c => isClassTime(m, c.day, c.si, timeSlots))) conflicts.push("수업 중");
    if (overlapping) conflicts.push("같은 시간 여러 층");
    else if (cells.some(c => FLOOR_KEYS.some(fk => fk !== c.fk && cellAt(schedule, c.day, c.si, fk) === m.name)))
      conflicts.push("같은 시간 타 층");

    // 규정을 넘지만 사서가 판단할 몫 — 알리기만 하고 막지 않는다
    const warnings = [];
    const badFloor = cells.find(c => !floorAllowed(m, c.fk));
    if (badFloor) warnings.push(`${m.preferFloor1} 담당`);
    if (week + hours > cap + 1e-9) warnings.push(`주 ${cap}h 초과`);
    for (const [day, h] of Object.entries(pickedByDay))
      if ((byDay[day] || 0) + h > cfg.maxDailyHours + 1e-9) {
        warnings.push(`${Object.keys(pickedByDay).length > 1 ? day + " " : ""}일 ${cfg.maxDailyHours}h 초과`);
        break;
      }
    const blocked = [...conflicts, ...warnings];

    // 소프트 점수 — 근거로 그대로 보여줄 수 있는 것만 넣는다
    let score = 0;
    const why = [];

    // 고른 묶음의 바로 앞/뒤 칸에 같은 사람이 있으면 근무가 이어진다
    const adjacent = [...runs.values()].some(r =>
      cellAt(schedule, r.day, r.sis[0] - 1, r.fk) === m.name ||
      cellAt(schedule, r.day, r.sis[r.sis.length - 1] + 1, r.fk) === m.name);
    if (adjacent) { score += 3; why.push("이어서 근무"); }

    // 선호 층은 시간 비율만큼 반영한다 (여러 층에 걸쳐 고를 수 있으므로)
    let prefH = 0, pref2H = 0;
    for (const c of cells) {
      const h = timeSlots[c.si].hours;
      if (prefersFloor1(m, c.fk) || (!m.preferFloor1 && (c.fk === "f3a" || c.fk === "f3b"))) prefH += h;
      else if (prefersFloor2(m, c.fk)) pref2H += h;
    }
    if (prefH > 0) { score += 2 * (prefH / hours); why.push(prefH === hours ? "1순위 층" : "일부 1순위 층"); }
    if (pref2H > 0) { score += 1 * (pref2H / hours); why.push(pref2H === hours ? "2순위 층" : "일부 2순위 층"); }

    const remain = cap - week;
    score += (remain / maxCap) * 1.5;

    if (Object.keys(pickedByDay).some(day => nearClass(m, day, runsOfDay(runs, day), timeSlots)))
      { score += 0.5; why.push("수업과 붙음"); }
    if (Object.keys(pickedByDay).some(day => (byDay[day] || 0) > 0))
      { score += 0.5; why.push("그날 이미 출근"); }

    const isCurrent = cells.every(c => cellAt(schedule, c.day, c.si, c.fk) === m.name);
    return { member: m, score, why, conflicts, warnings, blocked, remain, isCurrent };
  })
    // 넣을 수 있는 사람 → 넣을 수는 있지만 한도를 넘는 사람 → 아예 못 넣는 사람 순
    .sort((a, b) => tier(a) - tier(b) || b.score - a.score || a.member.name.localeCompare(b.member.name, "ko"));
}

// 그 요일에 고른 묶음들의 [시작, 끝] 시각
const runsOfDay = (runs, day) =>
  [...runs.values()].filter(r => r.day === day).map(r => [
    r.sis[0], r.sis[r.sis.length - 1],
  ]);

// 그날 수업과 근무 덩어리가 gap 이내로 붙어 있나 (등교 한 번에 수업+근무를 몰아주는 실제 운영 패턴).
// 1시간 — 그 이상 뜨면 "붙었다"고 보기 어렵다
function nearClass(m, day, ranges, timeSlots, gap = 1) {
  return ranges.some(([a, b]) => {
    const s = timeSlots[a].startH, e = timeSlots[b].startH + timeSlots[b].hours;
    return (m.classes || []).some(c => {
      if (c.day !== day) return false;
      const cs = c.startHour + c.startMin / 60, ce = c.endHour + c.endMin / 60;
      return cs - e <= gap && s - ce <= gap;
    });
  });
}

/**
 * 지금 짜여 있는 시간표에 문제가 없는지 훑는다.
 *
 * 지정한 칸은 사서 결정이라 자동배치가 한도·수업을 따지지 않고 그대로 둔다(scheduler의 pins).
 * 그래서 배치를 끝낸 뒤 학생 수업이 바뀌면 충돌이 조용히 남는다 — 그걸 눈에 보이게 하는 것이 이 함수다.
 * @returns [{ level: "error"|"warn", text }]
 */
export function audit(members, schedule, timeSlots, cfg) {
  const byName = Object.fromEntries(members.map(m => [m.name, m]));
  const label = si => timeSlots[si].label.split("\n")[0];
  const issues = [];
  const week = {}, daily = {};

  for (const day of DAYS) {
    for (let si = 0; si < timeSlots.length; si++) {
      const seen = new Set();
      for (const fk of FLOOR_KEYS) {
        const n = cellAt(schedule, day, si, fk);
        if (!n) continue;
        const m = byName[n];
        if (!m) { issues.push({ level: "error", text: `${day} ${label(si)} · 명단에 없는 이름 "${n}"` }); continue; }
        if (seen.has(n)) issues.push({ level: "error", text: `${n} · ${day} ${label(si)}에 두 자리` });
        seen.add(n);
        if (isClassTime(m, day, si, timeSlots)) issues.push({ level: "error", text: `${n} · ${day} ${label(si)} 수업 시간` });
        week[n] = (week[n] || 0) + timeSlots[si].hours;
        (daily[n] ||= {})[day] = (daily[n][day] || 0) + timeSlots[si].hours;
      }
    }
  }

  for (const [n, h] of Object.entries(week)) {
    const m = byName[n];
    if (!m) continue;
    const cap = capOf(m, cfg);
    if (h > cap + 1e-9) issues.push({ level: "warn", text: `${n} · 주 ${h}h (한도 ${cap}h)` });
    for (const [day, dh] of Object.entries(daily[n]))
      if (dh > cfg.maxDailyHours + 1e-9) issues.push({ level: "warn", text: `${n} · ${day} ${dh}h (하루 한도 ${cfg.maxDailyHours}h)` });
  }
  return issues;
}
