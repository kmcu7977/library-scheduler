import { DAYS, FLOOR_KEYS } from "./constants";
import { isClassTime, prefersFloor1, prefersFloor2, isLunchSlot, isAfternoonSlot, isMorningSlot } from "./utils";

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

  const canAssign = (name, day, si, slotH) => {
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

  const sortByConsec = (list, day, si) =>
    [...list].sort((a, b) => {
      const d = countConsecutive(b.name, day, si) - countConsecutive(a.name, day, si);
      return d !== 0 ? d : weeklyHours[a.name] - weeklyHours[b.name];
    });

  const FLOOR_TO_MAIN_KEY = { "2층": "f2", "3층": "f3a", "4층": "f4" };
  const preAssignEvening = () => {
    members.filter(m => m.preferFloor2).forEach(member => {
      const prefKey = FLOOR_TO_MAIN_KEY[member.preferFloor2];
      if (!prefKey) return;
      const hasClass = d => (member.classes || []).some(cls => cls.day === d);
      const sortedDays = [...DAYS].sort((a, b) => {
        const sa = hasClass(a) ? 0 : 1, sb = hasClass(b) ? 0 : 1;
        return sa !== sb ? sa - sb : DAYS.indexOf(a) - DAYS.indexOf(b);
      });
      for (const day of sortedDays) {
        const hasEveningClass = timeSlots.some((s, i) => s.startH >= 17 && isClassTime(member, day, i, timeSlots));
        if (hasEveningClass) continue;
        let anyAssigned = false;
        timeSlots.forEach((slot, si) => {
          if (slot.startH < 17 || si === halfSlotIdx) return;
          if (schedule[day][si][prefKey] !== null) return;
          const taken = Object.values(schedule[day][si]).filter(Boolean);
          if (taken.includes(member.name)) return;
          if (!canAssign(member.name, day, si, slot.hours)) return;
          schedule[day][si][prefKey] = member.name;
          weeklyHours[member.name] += slot.hours;
          dailyHours[member.name][day] += slot.hours;
          anyAssigned = true;
        });
        if (anyAssigned) break;
      }
    });
  };

  const assignFloor = (key) => {
    DAYS.forEach(day => {
      timeSlots.forEach((slot, si) => {
        if (si === halfSlotIdx) return;
        if (schedule[day][si][key] !== null) return;
        const slotH = slot.hours;
        const taken = Object.values(schedule[day][si]).filter(Boolean);
        const available = members.filter(m =>
          !taken.includes(m.name) &&
          canAssign(m.name, day, si, slotH) &&
          !(key === 'f3a' && m.preferFloor2)
        );
        if (available.length === 0) return;

        const assign = name => {
          schedule[day][si][key] = name;
          weeklyHours[name] += slotH;
          dailyHours[name][day] += slotH;
        };

        const prev = si > 0 ? schedule[day][si - 1][key] : null;
        const prevAvail = prev ? available.find(m => m.name === prev) : null;

        if (prevAvail && prefersFloor1(members.find(m => m.name === prev), key)) { assign(prev); return; }

        const pref1 = available.filter(m => prefersFloor1(m, key));
        if (pref1.length > 0) {
          const cont = pref1.find(m => m.name === prev);
          if (cont) { assign(cont.name); return; }
          assign(sortByConsec(pref1, day, si)[0].name); return;
        }

        if (slot.startH >= 17) {
          if (prevAvail && prefersFloor2(members.find(m => m.name === prev), key)) { assign(prev); return; }
          const pref2 = available.filter(m => prefersFloor2(m, key));
          if (pref2.length > 0) {
            const cont = pref2.find(m => m.name === prev);
            if (cont) { assign(cont.name); return; }
            assign(sortByConsec(pref2, day, si)[0].name); return;
          }
        }

        if (prevAvail) { assign(prev); return; }

        const classToday = available.filter(m => hasClassOnDay(m.name, day));
        if (classToday.length > 0) { assign(sortByConsec(classToday, day, si)[0].name); return; }

        assign(sortByConsec(available, day, si)[0].name);
      });

      if (halfSlotIdx === 0 && timeSlots.length > 1) {
        const nextName = schedule[day][1][key];
        schedule[day][0][key] = nextName;
        if (nextName) { weeklyHours[nextName] += timeSlots[0].hours; dailyHours[nextName][day] += timeSlots[0].hours; }
      }
    });
  };

  preAssignEvening();
  assignFloor("f2");
  assignFloor("f4");
  assignFloor("f3a");

  const lunchIdxs = timeSlots.map((s, i) => i).filter(i => isLunchSlot(timeSlots[i]));
  if (lunchIdxs.length > 0) {
    DAYS.forEach(day => {
      members.forEach(member => {
        const name = member.name;
        const hasMorning   = timeSlots.some((s, i) => isMorningSlot(s)   && FLOOR_KEYS.some(fk => schedule[day][i][fk] === name));
        const hasAfternoon = timeSlots.some((s, i) => isAfternoonSlot(s) && FLOOR_KEYS.some(fk => schedule[day][i][fk] === name));
        if (!hasMorning || !hasAfternoon) return;

        const hasFreeLunch = lunchIdxs.some(si => !FLOOR_KEYS.some(fk => schedule[day][si][fk] === name));
        if (hasFreeLunch) return;

        const occupied = lunchIdxs
          .map(si => ({ si, fk: FLOOR_KEYS.find(fk => schedule[day][si][fk] === name) }))
          .filter(x => x.fk);

        const getSubScore = (si, fk) => {
          const slotH = timeSlots[si].hours;
          const taken = Object.values(schedule[day][si]).filter(n => n && n !== name);
          const subs = members.filter(m => m.name !== name && !taken.includes(m.name) && canAssign(m.name, day, si, slotH));
          if (subs.length === 0) return 999;
          const prev = si > 0 ? schedule[day][si - 1][fk] : null;
          if (subs.some(s => s.name === prev && prefersFloor1(s, fk))) return 0;
          if (subs.some(s => prefersFloor1(s, fk))) return 1;
          if (subs.some(s => s.name === prev && prefersFloor2(s, fk))) return 2;
          if (subs.some(s => prefersFloor2(s, fk))) return 3;
          if (subs.some(s => s.name === prev)) return 4;
          return 5;
        };

        const toFree = occupied.reduce((best, curr) =>
          getSubScore(curr.si, curr.fk) < getSubScore(best.si, best.fk) ? curr : best
        );

        const { si: freeSi, fk: freeFk } = toFree;
        const slotH = timeSlots[freeSi].hours;
        schedule[day][freeSi][freeFk] = null;
        weeklyHours[name] -= slotH;
        dailyHours[name][day] -= slotH;

        const taken2 = Object.values(schedule[day][freeSi]).filter(Boolean);
        const subs = members.filter(m => m.name !== name && !taken2.includes(m.name) && canAssign(m.name, day, freeSi, slotH));
        if (subs.length === 0) return;

        const prev2 = freeSi > 0 ? schedule[day][freeSi - 1][freeFk] : null;
        const p1 = subs.filter(m => prefersFloor1(m, freeFk));
        let chosen;
        if (p1.length > 0) {
          chosen = p1.find(m => m.name === prev2) || sortByConsec(p1, day, freeSi)[0];
        } else {
          const p2 = subs.filter(m => prefersFloor2(m, freeFk));
          if (p2.length > 0) {
            chosen = p2.find(m => m.name === prev2) || sortByConsec(p2, day, freeSi)[0];
          } else if (prev2 && subs.find(m => m.name === prev2)) {
            chosen = subs.find(m => m.name === prev2);
          } else {
            chosen = sortByConsec(subs, day, freeSi)[0];
          }
        }

        schedule[day][freeSi][freeFk] = chosen.name;
        weeklyHours[chosen.name] += slotH;
        dailyHours[chosen.name][day] += slotH;
      });
    });
  }

  assignFloor("f3b");
  return schedule;
}
