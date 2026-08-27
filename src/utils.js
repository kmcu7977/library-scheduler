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
    return cs < endH && ce > startH;
  });
}

export function getAvailableMembers(members, day, si, timeSlots) {
  return members.filter(m => !isClassTime(m, day, si, timeSlots));
}

// 인원을 사람에게 보여줄 때는 항상 가나다순. 저장 배열 자체는 등록 순서를 유지한다
// (색 배정이 등록 순서 기준이라 데이터를 정렬하면 흔들린다)
export const compareByName = (a, b) => a.name.localeCompare(b.name, "ko");
export const sortedByName = members => [...members].sort(compareByName);

// 2층 선호자는 4층 금지, 4층 선호자는 2층 금지 (3층은 누구나). 단 본인이 2순위로 고른 층이면 허용
// scheduler.js(자동배치)와 recommend.js(추천)가 같은 규칙을 써야 하므로 여기 한 곳에만 둔다
export const floorAllowed = (member, key) => {
  if (key !== "f2" && key !== "f4") return true;
  const banned = key === "f2" ? "4층" : "2층";
  return member.preferFloor1 !== banned || member.preferFloor2 === KEY_TO_FLOOR[key];
};

export const prefersFloor1 = (member, key) => member.preferFloor1 ? member.preferFloor1 === KEY_TO_FLOOR[key] : false;
export const prefersFloor2 = (member, key) => member.preferFloor2 ? member.preferFloor2 === KEY_TO_FLOOR[key] : false;
export const isLunchSlot     = slot => slot.startH >= 12 && slot.startH < 14;
export const isAfternoonSlot = slot => slot.startH >= 14;
export const isMorningSlot   = slot => slot.startH < 12;

// Firebase는 배열에서 값이 통째로 빈 자리를 빼고 돌려준다.
// 시간표에서 한 시간대의 네 층이 모두 비면 그 시간대가 통째로 사라지는데,
// 이때 Object.values로 펴면 뒤 시간대가 한 칸씩 당겨져 시간표 전체가 어긋난다.
// (실데이터에도 전 층이 비는 시간대가 이미 있다 — 인덱스를 그대로 살려 되돌려야 한다)
export function restoreIndexed(saved, length) {
  // 배열로 올 때 빠진 자리는 null이 아니라 "구멍"이다. map은 구멍을 건너뛰어 그대로 남기고,
  // 그 구멍을 for...of로 훑으면 undefined가 나와 터진다 — Array.from은 구멍도 빈 값으로 채워 훑는다
  const entries = Array.isArray(saved) ? Array.from(saved, (v, i) => [i, v]) : Object.entries(saved || {});
  const size = Math.max(length || 0, ...entries.map(([i]) => +i + 1), 0);
  const out = Array.from({ length: size }, () => null);
  for (const [i, v] of entries) out[+i] = v ?? null;
  return out;
}
