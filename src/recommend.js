// 칸 추천 — "이 자리에 누가 맞나"를 근거와 함께 제시한다.
//
// 자동 전체배치(scheduler.js)와 역할이 다르다:
//   scheduler = 판을 대신 짜준다 / recommend = 사서가 짜고 도구는 근거만 댄다
// 그래서 규정을 넘는 사람도 숨기지 않는다. 사유를 붙여 아래로 내릴 뿐,
// 넣을지 말지는 사서가 정한다 (실제 수기 시간표에도 일 8h 초과가 존재함).
//
// 드래그로 여러 칸을 한 번에 고를 수 있으므로 슬롯은 항상 목록으로 다룬다.
// 여러 칸은 "한 덩어리 근무"로 평가한다 — 시간은 합계로, 수업 충돌은 하나라도 걸리면 불가.
import { DAYS, FLOOR_KEYS } from "./constants";
import { isClassTime, floorAllowed, prefersFloor1, prefersFloor2 } from "./utils";

// 근로 유형 = 주당 근무시간. 미설정자는 운영 설정의 기본값을 따른다
const capOf = (m, cfg) => m.weeklyHours ?? cfg.maxWeeklyHours;
const tier = (r) => (r.conflicts.length ? 2 : r.warnings.length ? 1 : 0);
const cellAt = (schedule, day, si, fk) => schedule?.[day]?.[si]?.[fk] || null;

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

// 이미 배정된 시간 합계. 지금 채우려는 칸들은 어차피 덮어쓰므로 계산에서 뺀다
function assignedHours(schedule, timeSlots, name, day, sis, fk) {
  const target = new Set(sis);
  let week = 0;
  const byDay = {};
  for (const d of DAYS) {
    for (let si = 0; si < timeSlots.length; si++) {
      for (const k of FLOOR_KEYS) {
        if (d === day && k === fk && target.has(si)) continue;
        if (schedule?.[d]?.[si]?.[k] !== name) continue;
        week += timeSlots[si].hours;
        byDay[d] = (byDay[d] || 0) + timeSlots[si].hours;
      }
    }
  }
  return { week, byDay };
}

// 그날 수업과 이 근무 덩어리가 gap 이내로 붙어 있나 (등교 한 번에 수업+근무를 몰아주는 실제 운영 패턴)
function nearClass(m, day, s, e, gap = 2) {
  return (m.classes || []).some(c => {
    if (c.day !== day) return false;
    const cs = c.startHour + c.startMin / 60, ce = c.endHour + c.endMin / 60;
    return cs - e <= gap && s - ce <= gap;
  });
}

/**
 * 한 자리(연속된 한 칸 이상)에 대한 후보 순위.
 * @param si 슬롯 인덱스 하나, 또는 드래그로 고른 여러 개
 * @returns [{ member, score, why[], conflicts[], warnings[], blocked[], remain, isCurrent }]
 *          conflicts = 배치 불가(수업·중복) / warnings = 규정 초과지만 사서 재량(한도·층) / blocked = 둘의 합
 */
export function recommend(members, schedule, timeSlots, cfg, day, si, fk) {
  const sis = (Array.isArray(si) ? [...si] : [si]).sort((a, b) => a - b);
  const first = sis[0], last = sis[sis.length - 1];
  const hours = sis.reduce((a, i) => a + timeSlots[i].hours, 0);
  const startH = timeSlots[first].startH;
  const endH = timeSlots[last].startH + timeSlots[last].hours;

  const at = (i, k) => schedule?.[day]?.[i]?.[k] || null;
  const here = sis.map(i => at(i, fk));
  // 잔여시간은 한도 대비 비율이 아니라 절대 시간으로 잰다.
  // 비율로 재면 주 40h와 20h인 두 사람이 똑같이 "100% 남음"이 되어, 채울 시간이 두 배인 쪽이 밀린다
  const maxCap = Math.max(...members.map(m => capOf(m, cfg)), 1);

  return members.map(m => {
    const { week, byDay } = assignedHours(schedule, timeSlots, m.name, day, sis, fk);
    const cap = capOf(m, cfg);
    const dayH = byDay[day] || 0;

    // 애초에 몸이 둘이 아니라 불가능한 것 — 넣지 못하게 막는다
    const conflicts = [];
    if (sis.some(i => isClassTime(m, day, i, timeSlots))) conflicts.push("수업 중");
    if (sis.some(i => FLOOR_KEYS.some(k => k !== fk && at(i, k) === m.name))) conflicts.push("같은 시간 타 층");
    // 규정을 넘지만 사서가 판단할 몫 — 알리기만 하고 막지 않는다
    const warnings = [];
    if (!floorAllowed(m, fk)) warnings.push(`${m.preferFloor1} 담당`);
    if (week + hours > cap + 1e-9) warnings.push(`주 ${cap}h 초과`);
    if (dayH + hours > cfg.maxDailyHours + 1e-9) warnings.push(`일 ${cfg.maxDailyHours}h 초과`);
    const blocked = [...conflicts, ...warnings];

    // 소프트 점수 — 근거로 그대로 보여줄 수 있는 것만 넣는다
    let score = 0;
    const why = [];
    if (at(first - 1, fk) === m.name || at(last + 1, fk) === m.name) { score += 3; why.push("이어서 근무"); }
    if (prefersFloor1(m, fk) || (!m.preferFloor1 && (fk === "f3a" || fk === "f3b"))) { score += 2; why.push("1순위 층"); }
    else if (prefersFloor2(m, fk)) { score += 1; why.push("2순위 층"); }
    const remain = cap - week;
    score += (remain / maxCap) * 1.5;
    if (nearClass(m, day, startH, endH)) { score += 0.5; why.push("수업과 붙음"); }
    if (dayH > 0) { score += 0.5; why.push("그날 이미 출근"); }

    return {
      member: m, score, why, conflicts, warnings, blocked, remain,
      isCurrent: here.every(n => n === m.name),
    };
  })
    // 넣을 수 있는 사람 → 넣을 수는 있지만 한도를 넘는 사람 → 아예 못 넣는 사람 순
    .sort((a, b) => tier(a) - tier(b) || b.score - a.score || a.member.name.localeCompare(b.member.name));
}
