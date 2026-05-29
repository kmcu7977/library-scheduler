import { KEY_TO_FLOOR } from "./constants";

export function buildTimeSlots(cfg) {
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

export function isClassTime(member, day, si, timeSlots) {
  if (!member.classes) return false;
  const { startH, hours } = timeSlots[si];
  const endH = startH + hours;
  return member.classes.some(cls => {
    if (cls.day !== day) return false;
    const cs = cls.startHour + cls.startMin / 60, ce = cls.endHour + cls.endMin / 60;
    if (cs < endH && ce > startH) return true;
    if (Math.abs(endH - cs) < 0.01 && endH >= 12 && endH <= 14) return true;
    return false;
  });
}

export function getAvailableMembers(members, day, si, timeSlots) {
  return members.filter(m => !isClassTime(m, day, si, timeSlots));
}

export const prefersFloor1 = (member, key) => member.preferFloor1 ? member.preferFloor1 === KEY_TO_FLOOR[key] : false;
export const prefersFloor2 = (member, key) => member.preferFloor2 ? member.preferFloor2 === KEY_TO_FLOOR[key] : false;
export const isLunchSlot     = slot => slot.startH >= 12 && slot.startH < 14;
export const isAfternoonSlot = slot => slot.startH >= 14;
export const isMorningSlot   = slot => slot.startH < 12;
