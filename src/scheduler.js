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
    if (m.timeSlot === "주간" && timeSlots[si].startH >= 17) return false; // 주간 선호 → 저녁 제외
    const maxW = m.isNight ? (cfg.maxNightWeeklyHours ?? cfg.maxWeeklyHours) : cfg.maxWeeklyHours;
    if (weeklyHours[name] + slotH > maxW) return false;
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
    const maxW = m.isNight ? (cfg.maxNightWeeklyHours ?? cfg.maxWeeklyHours) : cfg.maxWeeklyHours;
    for (let si = startSi; si < timeSlots.length; si++) {
      if (si === halfSlotIdx) continue;
      const slotH = timeSlots[si].hours;
      if (isClassTime(m, day, si, timeSlots)) break;
      if (m.timeSlot === "주간" && timeSlots[si].startH >= 17) break;
      if (wh + slotH > maxW || dh + slotH > cfg.maxDailyHours) break;
      // 다른 층에 이미 배치된 슬롯은 연속 체인을 끊는다 (reachesClose 오판 방지)
      if (FLOOR_KEYS.some(fk => schedule[day][si][fk] === name)) break;
      count++; wh += slotH; dh += slotH;
    }
    return count;
  };

  // 잔여 한도 비율 (0~1): 절대값 대신 비율 기준으로 정렬해야 야간 학생이 f2를 독점하지 않음
  // 예) 탁연주 15/30h=0.5 vs 성창영 15/20h=0.75 → 성창영 우선
  const remainingRatio = m => {
    const maxW = m.isNight ? (cfg.maxNightWeeklyHours ?? cfg.maxWeeklyHours) : cfg.maxWeeklyHours;
    return (maxW - weeklyHours[m.name]) / maxW;
  };

  // 현재 슬롯 시간대와 선호가 맞으면 +1, 아니면 0 (강제 아닌 soft 우선)
  const timeBoost = (m, si) => {
    if (!m.timeSlot) return 0;
    const h = timeSlots[si].startH;
    if (m.timeSlot === "주간" && h < 13) return 1;
    if (m.timeSlot === "야간" && h >= 13) return 1;
    return 0;
  };

  // 일반 학생 우선 → 잔여 비율 → 시간대 선호 → 긴 연속블록 → 주간↑ → 일일↑
  // 야간 학생(isNight)은 일반 학생이 모두 채운 뒤 남은 슬롯을 채운다
  const byBlock = (list, day, si) =>
    [...list].sort((a, b) => {
      const night = (a.isNight ? 1 : 0) - (b.isNight ? 1 : 0);
      if (night !== 0) return night;
      const r = remainingRatio(b) - remainingRatio(a);
      if (r !== 0) return r;
      const tb = timeBoost(b, si) - timeBoost(a, si);
      if (tb !== 0) return tb;
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

    // 선호층 배치 제약:
    // - 선호층이 설정된 인원은 자기 선호층 우선
    // - 2층/4층 선호 인원은 해당 슬롯의 자기 층이 이미 채워진 경우에만 3층에 overflow 허용
    // - 2층↔4층 간 교차 배치는 금지
    const pref1Blocked = m => {
      if (!m.preferFloor1) return false;
      if (prefersFloor1(m, key)) return false;
      if (key === "f3a" || key === "f3b") {
        const prefKey = m.preferFloor1 === "2층" ? "f2" : m.preferFloor1 === "4층" ? "f4" : null;
        if (!prefKey) return true; // pref1=3층 인원은 위에서 이미 처리
        return schedule[day][si][prefKey] === null; // 자기 층이 빈 경우 3층 차단
      }
      return true;
    };

    let avail = members.filter(m => !taken.includes(m.name) && !pref1Blocked(m) && canAssign(m.name, day, si, slotH, true));
    if (avail.length === 0) {
      // 점심 보호를 풀어야만 채울 수 있으면 완화
      avail = members.filter(m => !taken.includes(m.name) && !pref1Blocked(m) && canAssign(m.name, day, si, slotH, false));
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
        const maxW0 = m0?.isNight ? (cfg.maxNightWeeklyHours ?? cfg.maxWeeklyHours) : cfg.maxWeeklyHours;
        if (m0 && !isClassTime(m0, day, 0, timeSlots) && !FLOOR_KEYS.some(fk => schedule[day][0][fk] === name)
            && weeklyHours[name] + h0 <= maxW0 && dailyHours[name][day] + h0 <= cfg.maxDailyHours) {
          schedule[day][0][key] = name;
          weeklyHours[name] += h0;
          dailyHours[name][day] += h0;
        }
      }
    };

    const prev = si > 0 ? schedule[day][si - 1][key] : null;
    const prevAvail = prev ? avail.find(m => m.name === prev) : null;

    // 1) 1순위 선호층 패킹: 야간 학생이 해당 층의 주 담당 → 야간 먼저, 없을 때 일반 사용
    //    cont(직전 연속)는 야간/일반 구분 없이 이미 서 있으면 계속 유지
    const pref1 = avail.filter(m => prefersFloor1(m, key));
    if (pref1.length > 0) {
      const cont = pref1.find(m => m.name === prev);
      if (cont) { assign(cont.name); return; }
      const nightPref1 = pref1.filter(m => m.isNight);
      assign(byBlock(nightPref1.length > 0 ? nightPref1 : pref1, day, si)[0].name);
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

    // 5-2) 다음 슬롯에 이미 배치된 사람(저녁 먼저 배치 등)으로 이어붙임 → 이음새 단일셀 방지
    const next = si < timeSlots.length - 1 ? schedule[day][si + 1][key] : null;
    const nextAvail = next ? avail.find(m => m.name === next) : null;
    if (nextAvail) { assign(next); return; }

    // 6) 오늘 수업 있는 사람 우선(가용 시간이 한정적이므로 먼저 소진, 긴 블록 우선)
    const classToday = avail.filter(m => hasClassOnDay(m.name, day));
    if (classToday.length > 0) { assign(byBlock(classToday, day, si)[0].name); return; }

    // 7) 긴 연속블록 우선(균형은 byBlock 2차 기준 주간시간으로 반영)
    assign(byBlock(avail, day, si)[0].name);
  };

  // 슬롯 우선 × 요일 균등 패스(층별). slotFilter로 저녁/주간 단계를 분리한다.
  const assignFloor = (key, slotFilter) => {
    timeSlots.forEach((slot, si) => {
      if (si === halfSlotIdx) return;       // 0.5h 첫 슬롯은 si=1 배치 시 미러로 채움
      if (!slotFilter(slot)) return;
      DAYS.forEach(day => fillCell(key, day, si, slot));
    });
  };

  const isEvening = s => s.startH >= 17;
  const isDaytime = s => s.startH < 17;
  const FLOORS = ["f2", "f4", "f3a", "f3b"];   // f3b는 3층 둘째칸(overflow 잔여)

  // 저녁(17시~마감)은 교대 없이 연속이어야 하고 주 후반에 주간시간이 부족해지므로
  // 모든 층·요일의 저녁을 먼저 배치해 주간시간을 선점한다. 그 다음 주간을 채운다.
  FLOORS.forEach(k => assignFloor(k, isEvening));
  FLOORS.forEach(k => assignFloor(k, isDaytime));

  return schedule;
}
