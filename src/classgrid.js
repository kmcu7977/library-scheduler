// 수업 데이터를 "요일 × 한 시간" 격자로 접는다.
//
// 화면 두 벌(수업 중 / 근무 가능)은 반드시 같은 격자에서 나와야 한다.
// 각자 따로 계산하면 시간 축이 어긋나 "이 시간에 누가 비나"를 나란히 놓고 볼 수 없다.
import { DAYS, DAYS_KR } from "./constants";

export function buildClassGrid(members, cfg) {
  const items = members.flatMap(m => (m.classes || []).map(c => ({ ...c, name: m.name, color: m.color })));

  // 주말 수업은 있을 때만 열을 만든다 (근무는 월~금이지만 수업은 볼 수 있어야 하므로)
  const days = DAYS_KR.filter(d => DAYS.includes(d) || items.some(c => c.day === d));

  // 시간 축은 개관~폐관을 기본으로, 그 밖으로 삐져나온 수업까지 덮는다
  const starts = items.map(c => c.startHour + c.startMin / 60);
  const ends   = items.map(c => c.endHour + c.endMin / 60);
  const from = Math.floor(Math.min(cfg.openHour + cfg.openMin / 60, ...starts));
  const to   = Math.ceil(Math.max(cfg.closeHour + cfg.closeMin / 60, ...ends));
  const hours = [];
  for (let h = from; h < to; h++) hours.push(h);

  // grid[요일][시각] = 그 한 시간에 걸치는 수업들 / freeGrid = 그 시간에 수업이 없는 사람들
  const grid = {}, freeGrid = {};
  for (const d of days) {
    grid[d] = {};
    freeGrid[d] = {};
    for (const h of hours) {
      grid[d][h] = items.filter(c =>
        c.day === d && c.startHour + c.startMin / 60 < h + 1 && c.endHour + c.endMin / 60 > h);
      const busy = new Set(grid[d][h].map(c => c.name));
      freeGrid[d][h] = members.filter(m => !busy.has(m.name));
    }
  }

  return { days, hours, grid, freeGrid, noClass: members.filter(m => !(m.classes || []).length) };
}
