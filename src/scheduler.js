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

  // 17시 이후엔 교대가 없으므로, 저녁 자리는 마감까지 연속 근무 가능한 사람만 후보로 둔다.
  // si부터 마지막 슬롯까지 끊김 없이 갈 수 있으면 true.
  const lastIdx = timeSlots.length - 1;
  const reachesClose = (name, day, si) => si + countConsecutive(name, day, si) > lastIdx;

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

    // 저녁(17시 이후): 마감까지 갈 수 있는 사람이 있으면 그 사람들로만 후보를 좁힌다.
    // → 17시에 들어간 사람이 마감까지 근무(중간 교대 없음). 없으면 부득이 전체에서 채움.
    if (evening) {
      const closers = avail.filter(m => reachesClose(m.name, day, si));
      if (closers.length > 0) avail = closers;
    }

    const assign = name => {
      schedule[day][si][key] = name;
      weeklyHours[name] += slotH;
      dailyHours[name][day] += slotH;
      // 0.5h 첫 슬롯 미러: si=1 배치 시점에 즉시 si=0도 같은 사람으로 채움
      // (맨 마지막에 복사하면 한도가 차 있어 누락되므로 배치 직후 처리)
      if (halfSlotIdx === 0 && si === 1 && schedule[day][0][key] === null) {
        const h0 = timeSlots[0].hours;
        const m0 = members.find(x => x.name === name);
        if (m0 && !isClassTime(m0, day, 0, timeSlots) && !FLOOR_KEYS.some(fk => schedule[day][0][fk] === name)) {
          schedule[day][0][key] = name;
          weeklyHours[name] += h0;
          dailyHours[name][day] += h0;
        }
      }
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

  // 슬롯 우선 × 요일 균등 단일 패스(층별). 슬롯을 오전→저녁 순서로 한 번에 처리해
  // 한 근로자의 근무가 끊기지 않고 연속 블록으로 이어지도록 한다. (단계 분리 없음)
  const assignFloor = (key) => {
    timeSlots.forEach((slot, si) => {
      if (si === halfSlotIdx) return;       // 0.5h 첫 슬롯은 si=1 배치 시 미러로 채움
      DAYS.forEach(day => fillCell(key, day, si, slot));
    });
  };

  // 2층 → 4층 → 3층(f3a) → 3층 둘째칸(f3b, overflow 잔여)
  assignFloor("f2");
  assignFloor("f4");
  assignFloor("f3a");
  assignFloor("f3b");

  return schedule;
}
