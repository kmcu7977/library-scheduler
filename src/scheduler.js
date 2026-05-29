import { DAYS, FLOOR_KEYS } from "./constants";
import { isClassTime, prefersFloor1, prefersFloor2, isLunchSlot } from "./utils";

export function autoSchedule(members, timeSlots, cfg) {
  const schedule = {};
  DAYS.forEach(day => { schedule[day] = timeSlots.map(() => ({ f2: null, f3a: null, f3b: null, f4: null })); });

  const weeklyHours = {}, dailyHours = {};
  members.forEach(m => {
    weeklyHours[m.name] = 0;
    dailyHours[m.name] = {};
    DAYS.forEach(d => { dailyHours[m.name][d] = 0; });
  });

  const halfSlotIdx = timeSlots[0]?.hours === 0.5 ? 0 : -1;
  const lunchIdxs = timeSlots.map((_, i) => i).filter(i => isLunchSlot(timeSlots[i]));

  // 점심 보호: 한 사람이 같은 날 점심 슬롯을 2개 이상 차지하지 않게 해 휴식을 보장.
  // 점심 슬롯이 2개 이상일 때만 의미가 있으며, 인원이 부족하면 protectLunch=false로 완화한다.
  const canAssign = (name, day, si, slotH, protectLunch = true) => {
    const m = members.find(x => x.name === name);
    if (!m) return false;
    if (isClassTime(m, day, si, timeSlots)) return false;
    if (weeklyHours[name] + slotH > cfg.maxWeeklyHours) return false;
    if (dailyHours[name][day] + slotH > cfg.maxDailyHours) return false;
    if (protectLunch && lunchIdxs.length >= 2 && lunchIdxs.includes(si)) {
      const otherLunchTaken = lunchIdxs.some(li =>
        li !== si && FLOOR_KEYS.some(fk => schedule[day][li][fk] === name));
      if (otherLunchTaken) return false;
    }
    return true;
  };

  const hasClassOnDay = (name, day) => {
    const m = members.find(x => x.name === name);
    return m ? (m.classes || []).some(cls => cls.day === day) : false;
  };

  // 이 사람이 지금 슬롯부터 연속으로 몇 칸 더 근무 가능한지 (연속 배치 선호용 점수)
  const countConsecutive = (name, day, startSi) => {
    let count = 0, wh = weeklyHours[name], dh = dailyHours[name][day];
    const m = members.find(x => x.name === name);
    if (!m) return 0;
    for (let si = startSi; si < timeSlots.length; si++) {
      if (si === halfSlotIdx) continue;
      const slotH = timeSlots[si].hours;
      if (isClassTime(m, day, si, timeSlots)) break;
      if (wh + slotH > cfg.maxWeeklyHours || dh + slotH > cfg.maxDailyHours) break;
      count++; wh += slotH; dh += slotH;
    }
    return count;
  };

  // 균형 우선 정렬: 주간시간 적은 사람 → 그날 시간 적은 사람 → 연속근무 길게 가능한 사람
  const byLoad = (list, day, si) =>
    [...list].sort((a, b) => {
      const w = weeklyHours[a.name] - weeklyHours[b.name];
      if (w !== 0) return w;
      const d = dailyHours[a.name][day] - dailyHours[b.name][day];
      if (d !== 0) return d;
      return countConsecutive(b.name, day, si) - countConsecutive(a.name, day, si);
    });

  // 선호층 패킹용(best-fit): 한 번에 길게 일할 수 있는 사람부터.
  // 연속근무 가능시간↓ → 주간시간↑(같으면 덜 일한 사람) → 그날시간↑
  const byBlock = (list, day, si) =>
    [...list].sort((a, b) => {
      const c = countConsecutive(b.name, day, si) - countConsecutive(a.name, day, si);
      if (c !== 0) return c;
      const w = weeklyHours[a.name] - weeklyHours[b.name];
      if (w !== 0) return w;
      return dailyHours[a.name][day] - dailyHours[b.name][day];
    });

  // 한 칸(요일·슬롯·층) 배치
  const fillCell = (key, day, si, slot) => {
    if (schedule[day][si][key] !== null) return;
    const slotH = slot.hours;
    const evening = slot.startH >= 17;
    const taken = Object.values(schedule[day][si]).filter(Boolean);

    let avail = members.filter(m => !taken.includes(m.name) && canAssign(m.name, day, si, slotH, true));
    if (avail.length === 0) {
      // 점심 보호를 풀어야만 채울 수 있으면 완화
      avail = members.filter(m => !taken.includes(m.name) && canAssign(m.name, day, si, slotH, false));
    }
    if (avail.length === 0) return;

    const assign = name => {
      schedule[day][si][key] = name;
      weeklyHours[name] += slotH;
      dailyHours[name][day] += slotH;
    };

    const prev = si > 0 ? schedule[day][si - 1][key] : null;
    const prevAvail = prev ? avail.find(m => m.name === prev) : null;

    // 1) 1순위 선호 + 직전 연속 → 2) 1순위 선호(긴 연속블록 우선 패킹)
    const pref1 = avail.filter(m => prefersFloor1(m, key));
    if (pref1.length > 0) {
      const cont = pref1.find(m => m.name === prev);
      assign((cont || byBlock(pref1, day, si)[0]).name);
      return;
    }

    // 저녁 슬롯은 2순위 선호 인원으로 채움 (3) 직전 연속 → 4) 긴 연속블록 우선)
    if (evening) {
      const pref2 = avail.filter(m => prefersFloor2(m, key));
      if (pref2.length > 0) {
        const cont = pref2.find(m => m.name === prev);
        assign((cont || byBlock(pref2, day, si)[0]).name);
        return;
      }
    }

    // 5) 직전 슬롯과 동일인 연속
    if (prevAvail) { assign(prev); return; }

    // 6) 오늘 수업 있는 사람 우선(가용 시간이 한정적이므로 먼저 소진)
    const classToday = avail.filter(m => hasClassOnDay(m.name, day));
    if (classToday.length > 0) { assign(byLoad(classToday, day, si)[0].name); return; }

    // 7) 최소근무 우선
    assign(byLoad(avail, day, si)[0].name);
  };

  // 슬롯 우선 × 요일 균등 패스. slotFilter로 저녁/주간 단계를 분리한다.
  const assignPass = (key, slotFilter) => {
    timeSlots.forEach((slot, si) => {
      if (si === halfSlotIdx) return;       // 0.5h 첫 슬롯은 마지막에 복사
      if (!slotFilter(slot)) return;
      DAYS.forEach(day => fillCell(key, day, si, slot));
    });
  };

  const isEvening = s => s.startH >= 17;
  const isDaytime = s => s.startH < 17;
  const MAIN = ["f2", "f4", "f3a"];

  // 1단계: 채우기 어려운 저녁부터 (1순위 → 2순위), 2단계: 주간(점심 보호 포함)
  MAIN.forEach(k => assignPass(k, isEvening));
  MAIN.forEach(k => assignPass(k, isDaytime));
  // 3층 둘째 칸(f3b)은 잔여 인원으로 overflow 처리
  assignPass("f3b", isEvening);
  assignPass("f3b", isDaytime);

  // 0.5h 첫 슬롯: 다음 슬롯(si=1) 배치를 그대로 복사 (제약 충족 시에만)
  if (halfSlotIdx === 0 && timeSlots.length > 1) {
    const h0 = timeSlots[0].hours;
    DAYS.forEach(day => {
      FLOOR_KEYS.forEach(key => {
        const nm = schedule[day][1][key];
        if (!nm || schedule[day][0][key] !== null) return;
        const m = members.find(x => x.name === nm);
        if (!m || isClassTime(m, day, 0, timeSlots)) return;
        if (FLOOR_KEYS.some(fk => schedule[day][0][fk] === nm)) return;   // 같은 칸 중복 방지
        if (weeklyHours[nm] + h0 > cfg.maxWeeklyHours) return;
        if (dailyHours[nm][day] + h0 > cfg.maxDailyHours) return;
        schedule[day][0][key] = nm;
        weeklyHours[nm] += h0;
        dailyHours[nm][day] += h0;
      });
    });
  }

  return schedule;
}
