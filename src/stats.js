// 근무시간 집계.
//
// 시간표는 월~금 한 주치가 반복되는 구조라, 기간 합계는 주간 합계에 주 수를 곱해서 낸다.
// (특정 주만 빼거나 더하는 기능은 없으므로 실제로 곱셈이 맞다)
import { DAYS, FLOOR_KEYS } from "./constants";
import { sortedByName } from "./utils";

export const EVENING_FROM = 17;

/**
 * 학생별 근무시간 집계.
 * @param weeks 기간 환산에 쓸 주 수 (기본 4주 = 한 달치)
 * @returns { rows: [{member, byDay, week, evening, days, cap, period, capPeriod}], total, weeks }
 */
export function memberStats(members, schedule, timeSlots, cfg, weeks = 4) {
  const rows = sortedByName(members).map(m => {
    const byDay = {};
    let week = 0, evening = 0;
    for (const day of DAYS) {
      let h = 0;
      for (let si = 0; si < timeSlots.length; si++) {
        for (const fk of FLOOR_KEYS) {
          if (schedule?.[day]?.[si]?.[fk] !== m.name) continue;
          h += timeSlots[si].hours;
          if (timeSlots[si].startH >= EVENING_FROM) evening += timeSlots[si].hours;
        }
      }
      byDay[day] = h;
      week += h;
    }
    const cap = m.weeklyHours ?? cfg.maxWeeklyHours;
    return {
      member: m, byDay, week, evening, cap,
      days: DAYS.filter(d => byDay[d] > 0).length,   // 주당 출근 일수
      period: week * weeks,
      capPeriod: cap * weeks,
    };
  });

  const sum = pick => rows.reduce((a, r) => a + pick(r), 0);
  const total = {
    week: sum(r => r.week),
    period: sum(r => r.period),
    evening: sum(r => r.evening),
    cap: sum(r => r.cap),
    capPeriod: sum(r => r.capPeriod),
    byDay: Object.fromEntries(DAYS.map(d => [d, sum(r => r.byDay[d])])),
  };
  return { rows, total, weeks };
}
