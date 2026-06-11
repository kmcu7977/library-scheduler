// 시프트 블록 기반 자동배치 v3
// 구조: 단순 초기해 → 담금질 최적화(모든 정책 = 목적함수 하나) → 마무리 스윕
//
// 기준: 사서 선생님 수기 시간표 분석 + 확인된 운영 정책
//  - 교대는 시프트 경계(개관/12/13/14/17)에서만: M(개관~12) L1(12~13) L2(13~14) B(14~17) E(17~마감)
//  - 하루 최대 2개 연속 근무 묶음(점심 갭/주간+저녁 분리)
//  - 야간수업 학생(isNight) = 주간 백본: 자기 선호층 오전·오후, 저녁 근무 안 함
//  - 수업이 늦은 오후(15~17시)에 끝나는 날은 이어서 저녁 근무 선호(등교 1회), 17시 넘겨 끝나면 회피
//  - 2·4층 선호 일반학생은 주 한도까지 거의 채움, 3층/무선호는 잔여 커버
//  - 주 합계 ≈ 예산(월 900h → 주 ~207h), 부족분은 3층 둘째칸(f3b)
//  - timeSlot 필드는 제약으로 쓰지 않음(수업시간이 실제 제약)
//  - 수업일 주간 근무는 수업과 한 덩어리로(인접 gap≤2h), 출근 일수는 적게·길게
import { DAYS, FLOOR_KEYS } from "./constants";
import { isClassTime, prefersFloor1, prefersFloor2 } from "./utils";

// pins: 사서가 고정한 칸 {요일: {슬롯인덱스: {층키: 이름}}} — 재생성 시 그대로 유지
// prev: 직전 시간표 — 주어지면 제약이 허용하는 한 기존 배치를 유지(재배치 시 판 전체가 섞이는 것 방지)
export function autoSchedule(members, timeSlots, cfg, pins = null, prev = null) {
  const N = timeSlots.length;
  const W = cfg.tuning ?? {};

  // ===== 시프트 그리드 =====
  const shiftOf = (si) => {
    const h = timeSlots[si].startH;
    if (h < 12) return "M";
    if (h < 13) return "L1";
    if (h < 14) return "L2";
    if (h < 17) return "B";
    return "E";
  };
  const SHIFTS = {};
  timeSlots.forEach((s, si) => { (SHIFTS[shiftOf(si)] ||= []).push(si); });
  const SHIFT_KEYS = ["E", "M", "B", "L1", "L2"].filter((k) => SHIFTS[k]);

  // ===== 상태 =====
  const schedule = {};
  DAYS.forEach((d) => { schedule[d] = timeSlots.map(() => ({ f2: null, f3a: null, f3b: null, f4: null })); });
  const weekly = {}, daily = {};
  members.forEach((m) => { weekly[m.name] = 0; daily[m.name] = Object.fromEntries(DAYS.map((d) => [d, 0])); });
  const byName = Object.fromEntries(members.map((m) => [m.name, m]));

  const capOf = (m) => (m.isNight ? (cfg.maxNightWeeklyHours ?? cfg.maxWeeklyHours) : cfg.maxWeeklyHours);
  const hoursOf = (sis) => sis.reduce((a, si) => a + timeSlots[si].hours, 0);
  const occupiedBy = (day, si, name) => FLOOR_KEYS.some((fk) => schedule[day][si][fk] === name);
  const personSlots = (day, name) => {
    const sis = [];
    for (let si = 0; si < N; si++) if (occupiedBy(day, si, name)) sis.push(si);
    return sis;
  };
  const runCount = (sis) => {
    let runs = 0;
    for (let i = 0; i < sis.length; i++) if (i === 0 || sis[i] !== sis[i - 1] + 1) runs++;
    return runs;
  };
  const canTake = (m, day, sis, { maxRuns = 2 } = {}) => {
    const h = hoursOf(sis);
    if (weekly[m.name] + h > capOf(m) + 1e-9) return false;
    if (daily[m.name][day] + h > cfg.maxDailyHours + 1e-9) return false;
    for (const si of sis) {
      if (isClassTime(m, day, si, timeSlots)) return false;
      if (occupiedBy(day, si, m.name)) return false;
    }
    return runCount([...new Set([...personSlots(day, m.name), ...sis])].sort((a, b) => a - b)) <= maxRuns;
  };
  const place = (name, day, fl, sis) => {
    for (const si of sis) {
      schedule[day][si][fl] = name;
      weekly[name] += timeSlots[si].hours;
      daily[name][day] += timeSlots[si].hours;
    }
  };
  const unassign = (name, day, fl, sis) => {
    for (const si of sis) {
      schedule[day][si][fl] = null;
      weekly[name] -= timeSlots[si].hours;
      daily[name][day] -= timeSlots[si].hours;
    }
  };
  // 2층 선호자는 4층 금지, 4층 선호자는 2층 금지 (3층은 누구나)
  const floorOk = (m, fl) => {
    if (fl === "f3a" || fl === "f3b") return true;
    const here = fl === "f2" ? "2층" : "4층";
    // 반대층 1순위면 금지하되, 본인이 2순위로 고른 층이면 허용
    return m.preferFloor1 !== (fl === "f2" ? "4층" : "2층") || m.preferFloor2 === here;
  };
  const prefFloorKey = (m) => (m.preferFloor1 === "2층" ? "f2" : m.preferFloor1 === "4층" ? "f4" : null);

  // ===== 고정 칸 선배치: 알고리즘이 절대 건드리지 않음 (한도보다 사서 결정 우선) =====
  const pinnedSet = new Set(); // "요일|si|층키"
  if (pins) {
    for (const day of DAYS) {
      for (const [siStr, byFloor] of Object.entries(pins[day] ?? {})) {
        const si = Number(siStr);
        if (!(si >= 0 && si < N)) continue;
        for (const [fl, name] of Object.entries(byFloor ?? {})) {
          if (!FLOOR_KEYS.includes(fl) || !byName[name] || schedule[day][si][fl] !== null) continue;
          place(name, day, fl, [si]);
          pinnedSet.add(`${day}|${si}|${fl}`);
        }
      }
    }
  }
  const isPinned = (day, si, fl) => pinnedSet.has(`${day}|${si}|${fl}`);

  // ===== 이전 시간표 앵커: 재배치 시 기존 배치를 가능한 한 유지, 핀 때문에 못 지키는 칸만 바뀜 =====
  if (prev) {
    for (const day of DAYS) {
      for (let si = 0; si < N; si++) {
        const cell = prev[day]?.[si];
        if (!cell) continue;
        for (const fl of FLOOR_KEYS) {
          const n = cell[fl];
          if (!n || !byName[n] || schedule[day][si][fl] !== null) continue;
          if (floorOk(byName[n], fl) && canTake(byName[n], day, [si])) place(n, day, fl, [si]);
        }
      }
    }
  }

  // 요일별 마지막 수업 종료 시각 (저녁 회피 판단용)
  const lastClassEnd = {};
  for (const m of members) {
    lastClassEnd[m.name] = {};
    for (const d of DAYS) {
      let end = -1;
      for (const c of m.classes || []) if (c.day === d) end = Math.max(end, c.endHour + c.endMin / 60);
      lastClassEnd[m.name][d] = end;
    }
  }
  const hasClassOnDay = (m, day) => lastClassEnd[m.name][day] >= 0;

  // 요일별 수업 구간 [시작, 끝] 목록 (수업 인접 판정용)
  const classIvs = {};
  for (const m of members) {
    classIvs[m.name] = {};
    for (const d of DAYS)
      classIvs[m.name][d] = (m.classes || []).filter((c) => c.day === d)
        .map((c) => [c.startHour + c.startMin / 60, c.endHour + c.endMin / 60]);
  }

  // 점심 보호용 비트마스크: 11~15시를 30분×8칸으로 보고 수업/슬롯이 차지하는 칸 표시
  const LUNCH_FROM = 11, LUNCH_BITS = 8;
  const maskOf = (s, e) => {
    let m = 0;
    for (let k = 0; k < LUNCH_BITS; k++) {
      const t = LUNCH_FROM + k * 0.5;
      if (s < t + 0.5 - 1e-9 && e > t + 1e-9) m |= 1 << k;
    }
    return m;
  };
  const hasLunchGap = (mask) => { // 연속 30분×2 = 1h 공백
    for (let k = 0; k < LUNCH_BITS - 1; k++) if ((mask & (3 << k)) === 0) return true;
    return false;
  };
  const slotLunchMask = timeSlots.map((s) => maskOf(s.startH, s.startH + s.hours));
  const classLunchMask = {};
  for (const m of members) {
    classLunchMask[m.name] = {};
    for (const d of DAYS) {
      let mk = 0;
      for (const [cs, ce] of classIvs[m.name][d]) mk |= maskOf(cs, ce);
      classLunchMask[m.name][d] = mk;
    }
  }

  // ===== 목적함수 (정책 전부 여기) =====
  const OBJ = {
    w24: W.w24 ?? 1.7,                 // 2·4층 선호 일반: 한도까지 채움
    wNight: W.wNight ?? 2.0,           // 야간 백본 (2층 주담당이 자기 층을 더 채우도록)
    w3: W.w3 ?? 1.0,                   // 3층 선호/무선호
    concave: W.objConcave ?? 0.009,    // 한계효용 체감 (몰아주기 방지)
    prefHour: W.objPrefHour ?? 0.3,    // 1순위 선호층(무선호=3층) 근무 시간당 보너스
    pref2Hour: W.objPref2Hour ?? 0.05, // 2순위 선호층 근무 시간당 보너스 (약한 타이브레이커 — 세게 주면 사진과 오히려 멀어짐)
    nightEveHour: W.objNightEveHour ?? 3,    // 야간생 저녁 시간당 패널티
    lateClassEveHour: W.objLateClassEveHour ?? 1, // 그날 수업 16시 이후 종료자의 저녁 시간당 패널티
    classDayHour: W.objClassDayHour ?? 0.25, // 그날 수업 있는 일반학생 주간 시간당 보너스
    runPenalty: W.objRunPenalty ?? 0.6,      // 하루 묶음 추가당 패널티
    shortRun: W.objShortRun ?? 0.3,          // 점심 외 1슬롯 고립 묶음 패널티
    budgetMiss: W.objBudgetMiss ?? 1.5,      // 주 예산 편차 시간당 패널티
    maxEveNights: W.objMaxEveNights ?? 3,    // 주당 저녁 일수 상한
    eveOver: W.objEveOver ?? 0.8,
    backboneB: W.objBackboneB ?? 1.5,        // 야간 백본이 자기층 오후(B) 사수 시 보너스/일
    backboneM: W.objBackboneM ?? 1.2,        // 야간 백본이 자기층 오전(M) 사수 시 보너스/일
    stability: W.objStability ?? 0.05,       // prev와 같은 칸 유지 시간당 보너스 (동급 해 셔플 방지 타이브레이커)
    dayCost: W.objDayCost ?? 0.3,            // 출근일당 고정 패널티 (출근 일수 최소화, 몰아주기)
    farClass: W.objFarClass ?? 1.5,          // 수업일 주간 묶음이 수업과 안 붙어 있으면 시간당 패널티
    adjGap: W.objAdjGap ?? 2,                // 수업 인접 판정 허용 gap (h)
    freeDayMin: W.objFreeDayMin ?? 4,        // 수업 없는 날 출근 시 최소 근무시간
    freeShort: W.objFreeShort ?? 0,          // 그 미달분 시간당 패널티 (기본 off: 사진 일치엔 역효과, 필요 시 튜닝)
    noLunch: W.objNoLunch ?? 1.0,            // 근무 탓에 11~15시에 1h 식사 공백이 사라진 사람-일당 패널티
    eveAdj: W.objEveAdj ?? 1.0,              // 그날 수업이 늦은 오후(eveAdjFrom~17시)에 끝나는 사람의 저녁 근무 시간당 보너스
    eveAdjFrom: W.objEveAdjFrom ?? 15,
  };
  const typeWeight = (m) =>
    m.isNight ? OBJ.wNight : (m.preferFloor1 === "2층" || m.preferFloor1 === "4층") ? OBJ.w24 : OBJ.w3;

  const budget = cfg.weeklyBudgetHours ?? Math.round(((cfg.monthlyBudgetHours ?? 900) / 4.345) * 2) / 2;
  const totalHours = () => Object.values(weekly).reduce((a, b) => a + b, 0);

  const objective = () => {
    let J = 0;
    for (const m of members) {
      const h = weekly[m.name];
      J += typeWeight(m) * (h - OBJ.concave * h * h);
    }
    const eveNights = {};
    for (const day of DAYS) {
      const slotsOf = {};
      for (let si = 0; si < N; si++) {
        for (const fl of FLOOR_KEYS) {
          const n = schedule[day][si][fl];
          if (!n) continue;
          (slotsOf[n] ||= []).push(si);
          const m = byName[n], h = timeSlots[si].hours, sk = shiftOf(si);
          if (prefersFloor1(m, fl) || (!m.preferFloor1 && (fl === "f3a" || fl === "f3b"))) J += OBJ.prefHour * h;
          else if (prefersFloor2(m, fl)) J += OBJ.pref2Hour * h;
          if (prev && prev[day]?.[si]?.[fl] === n) J += OBJ.stability * h;
          if (sk === "E") {
            (eveNights[n] ||= new Set()).add(day);
            if (m.isNight) J -= OBJ.nightEveHour * h;
            else {
              // 수업이 늦은 오후에 끝나는 날은 이어서 저녁 근무가 오히려 효율적(등교 1회) — 사진 분석 결과
              const end = lastClassEnd[n][day];
              if (end >= OBJ.eveAdjFrom && end <= 17 + 1e-9) J += OBJ.eveAdj * h;
              else if (end >= 16) J -= OBJ.lateClassEveHour * h;
            }
          } else if (!m.isNight && hasClassOnDay(m, day)) J += OBJ.classDayHour * h;
        }
      }
      for (const [n, sis] of Object.entries(slotsOf)) {
        const u = [...new Set(sis)].sort((a, b) => a - b);
        J -= OBJ.runPenalty * (runCount(u) - 1);
        J -= OBJ.dayCost;
        const ivs = classIvs[n][day];
        let dayH = 0, s = u[0];
        for (let i = 1; i <= u.length; i++) {
          if (i < u.length && u[i] === u[i - 1] + 1) continue;
          const sa = s, sb = u[i - 1];
          if (i < u.length) s = u[i];
          let segH = 0;
          for (let si = sa; si <= sb; si++) segH += timeSlots[si].hours;
          dayH += segH;
          if (sa === sb && !["L1", "L2"].includes(shiftOf(sa))) J -= OBJ.shortRun;
          if (ivs.length && shiftOf(sa) !== "E") {
            const rs = timeSlots[sa].startH, re = timeSlots[sb].startH + timeSlots[sb].hours;
            const adj = ivs.some(([cs, ce]) => (ce <= rs + 1e-9 && rs - ce <= OBJ.adjGap) || (re <= cs + 1e-9 && cs - re <= OBJ.adjGap));
            if (!adj) J -= OBJ.farClass * segH;
          }
        }
        if (!ivs.length && dayH < OBJ.freeDayMin) J -= OBJ.freeShort * (OBJ.freeDayMin - dayH);
        const cm = classLunchMask[n][day];
        if (hasLunchGap(cm)) { // 수업만으로 이미 점심이 막힌 날은 근무 책임이 아님
          let wm = cm;
          for (const si of u) wm |= slotLunchMask[si];
          if (!hasLunchGap(wm)) J -= OBJ.noLunch;
        }
      }
    }
    for (const s of Object.values(eveNights)) J -= OBJ.eveOver * Math.max(0, s.size - OBJ.maxEveNights);
    for (const m of members) {
      const fl = m.isNight ? prefFloorKey(m) : null;
      if (!fl) continue;
      for (const day of DAYS) {
        if ((SHIFTS.B ?? []).every((si) => schedule[day][si][fl] === m.name)) J += OBJ.backboneB;
        if ((SHIFTS.M ?? []).every((si) => schedule[day][si][fl] === m.name)) J += OBJ.backboneM;
      }
    }
    J -= OBJ.budgetMiss * Math.abs(totalHours() - budget);
    return J;
  };

  // ===== 초기해: 단순 우선순위로 빈칸 없이 깔기 =====
  const REQUIRED = ["f2", "f4", "f3a"];
  const seedSort = (cands, fl, sk) =>
    cands.sort((a, b) => {
      const ev = sk === "E";
      const key = (m) =>
        (ev && m.isNight ? -10 : 0) +                      // 야간생 저녁 최후순위
        (prefersFloor1(m, fl) ? 4 : prefersFloor2(m, fl) ? 1 : 0) +
        (!m.preferFloor1 && (fl === "f3a" || fl === "f3b") ? 2 : 0) +
        (m.isNight && !ev ? 3 : 0) +                       // 야간생 주간 우선
        (capOf(m) - weekly[m.name]) / capOf(m);
      return key(b) - key(a) || a.name.localeCompare(b.name, "ko");
    });
  const coverRange = (day, fl, sis, sk) => {
    if (!sis.length) return;
    for (let len = sis.length; len >= 1; len--) {
      const part = sis.slice(0, len);
      const cands = seedSort(members.filter((m) => floorOk(m, fl) && canTake(m, day, part)), fl, sk);
      if (cands.length) {
        place(cands[0].name, day, fl, part);
        coverRange(day, fl, sis.slice(len), sk);
        return;
      }
    }
    coverRange(day, fl, sis.slice(1), sk); // 첫 칸 포기(최종 보수에서 재시도)
  };
  for (const sk of SHIFT_KEYS) for (const day of DAYS) for (const fl of REQUIRED) {
    coverRange(day, fl, (SHIFTS[sk] || []).filter((si) => schedule[day][si][fl] === null), sk);
  }

  // ===== f3b 예산 채움 (2h 이상 또는 시프트 전체 블록) =====
  const f3bBlocks = (m) => {
    const blocks = [];
    for (const day of DAYS) for (const sk of SHIFT_KEYS) {
      let run = [];
      for (const si of SHIFTS[sk]) {
        const free = schedule[day][si].f3b === null && !isClassTime(m, day, si, timeSlots) && !occupiedBy(day, si, m.name);
        if (free) run.push(si);
        else { if (run.length) blocks.push({ day, sk, sis: run }); run = []; }
      }
      if (run.length) blocks.push({ day, sk, sis: run });
    }
    return blocks.filter((b) => canTake(m, b.day, b.sis) && (hoursOf(b.sis) >= 2 || b.sis.length === SHIFTS[b.sk].length));
  };
  const fillBudget = () => {
    for (let guard = 0; guard < 100 && totalHours() + 0.5 <= budget; guard++) {
      let best = null;
      for (const m of members) {
        for (const b of f3bBlocks(m)) {
          place(m.name, b.day, "f3b", b.sis);
          const J = objective();
          unassign(m.name, b.day, "f3b", b.sis);
          if (!best || J > best.J) best = { m, b, J };
        }
      }
      if (!best) break;
      place(best.m.name, best.b.day, "f3b", best.b.sis);
    }
  };
  fillBudget();

  // ===== 담금질 최적화: 교체/스왑/f3b 제거 (멀티 리스타트) =====
  let seed = 20260610;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const listUnits = () => {
    const units = [];
    for (const day of DAYS) for (const fl of FLOOR_KEYS) for (const sk of SHIFT_KEYS) {
      let cur = null;
      for (const si of SHIFTS[sk]) {
        const n = isPinned(day, si, fl) ? null : schedule[day][si][fl]; // 고정 칸은 이동 대상 제외
        if (n && cur && cur.owner === n) cur.sis.push(si);
        else {
          if (cur) units.push(cur);
          cur = n ? { day, fl, sk, owner: n, sis: [si] } : null;
        }
      }
      if (cur) units.push(cur);
    }
    return units;
  };
  const snapshot = () => JSON.stringify(schedule);
  const restore = (snap) => {
    const s = JSON.parse(snap);
    for (const day of DAYS) for (let si = 0; si < N; si++) for (const fl of FLOOR_KEYS) schedule[day][si][fl] = s[day][si][fl];
    members.forEach((m) => { weekly[m.name] = 0; DAYS.forEach((d) => { daily[m.name][d] = 0; }); });
    for (const day of DAYS) for (let si = 0; si < N; si++) for (const fl of FLOOR_KEYS) {
      const n = schedule[day][si][fl];
      if (n) { weekly[n] += timeSlots[si].hours; daily[n][day] += timeSlots[si].hours; }
    }
  };

  const RESTARTS = W.optRestarts ?? 5;
  const ITER = W.optIterations ?? 15000;
  const initSnap = snapshot();
  let globalBestJ = -Infinity, globalBestSnap = initSnap;
  for (let restart = 0; restart < RESTARTS; restart++) {
    restore(initSnap);
    seed = 20260610 + restart * 7919;
    let curJ = objective(), bestJ = curJ, bestSnap = snapshot();
    for (let it = 0; it < ITER; it++) {
      const T = 0.4 * (1 - it / ITER) + 0.02; // 담금질 온도
      const accept = (newJ) => newJ > curJ + 1e-9 || rng() < Math.exp((newJ - curJ) / T);
      const units = listUnits();
      const u = units[Math.floor(rng() * units.length)];
      if (!u) break;
      const r = rng();

      if (r < 0.35) {
        // 스왑: 두 블록 주인 맞교환
        const u2 = units[Math.floor(rng() * units.length)];
        if (!u2 || u2.owner === u.owner) continue;
        const m1 = byName[u.owner], m2 = byName[u2.owner];
        if (!floorOk(m2, u.fl) || !floorOk(m1, u2.fl)) continue;
        unassign(u.owner, u.day, u.fl, u.sis);
        unassign(u2.owner, u2.day, u2.fl, u2.sis);
        let ok = false;
        if (canTake(m2, u.day, u.sis)) {
          place(m2.name, u.day, u.fl, u.sis);
          if (canTake(m1, u2.day, u2.sis)) {
            place(m1.name, u2.day, u2.fl, u2.sis);
            const newJ = objective();
            if (accept(newJ)) { curJ = newJ; ok = true; }
            else { unassign(m1.name, u2.day, u2.fl, u2.sis); unassign(m2.name, u.day, u.fl, u.sis); }
          } else unassign(m2.name, u.day, u.fl, u.sis);
        }
        if (!ok) { place(u.owner, u.day, u.fl, u.sis); place(u2.owner, u2.day, u2.fl, u2.sis); }
      } else if (r < 0.9 || u.fl !== "f3b") {
        // 교체: 블록을 다른 사람에게
        const cands = members.filter((m) => m.name !== u.owner && floorOk(m, u.fl));
        const repl = cands[Math.floor(rng() * cands.length)];
        if (!repl) continue;
        unassign(u.owner, u.day, u.fl, u.sis);
        if (canTake(repl, u.day, u.sis)) {
          place(repl.name, u.day, u.fl, u.sis);
          const newJ = objective();
          if (accept(newJ)) curJ = newJ;
          else { unassign(repl.name, u.day, u.fl, u.sis); place(u.owner, u.day, u.fl, u.sis); }
        } else place(u.owner, u.day, u.fl, u.sis);
      } else {
        // f3b 블록 제거
        unassign(u.owner, u.day, u.fl, u.sis);
        const newJ = objective();
        if (accept(newJ)) curJ = newJ;
        else place(u.owner, u.day, u.fl, u.sis);
      }

      if (curJ > bestJ + 1e-9) { bestJ = curJ; bestSnap = snapshot(); }
    }
    restore(bestSnap);
    fillBudget(); // 최적화 중 빠진 예산 재보충

    // ── 결정적 마무리 스윕: 모든 블록 쌍 스왑/전원 교체를 개선 없을 때까지 ──
    curJ = objective();
    for (let sweep = 0; sweep < 6; sweep++) {
      let improved = false;
      const units = listUnits();
      for (const u of units) {
        // 교체 시도
        for (const repl of members) {
          if (repl.name === u.owner || !floorOk(repl, u.fl)) continue;
          if (schedule[u.day][u.sis[0]][u.fl] !== u.owner) break; // 이미 바뀐 블록
          unassign(u.owner, u.day, u.fl, u.sis);
          if (canTake(repl, u.day, u.sis)) {
            place(repl.name, u.day, u.fl, u.sis);
            const J = objective();
            if (J > curJ + 1e-9) { curJ = J; improved = true; break; }
            unassign(repl.name, u.day, u.fl, u.sis);
          }
          place(u.owner, u.day, u.fl, u.sis);
        }
        // 스왑 시도
        for (const u2 of units) {
          if (u2 === u || u2.owner === u.owner) continue;
          if (schedule[u.day][u.sis[0]][u.fl] !== u.owner || schedule[u2.day][u2.sis[0]][u2.fl] !== u2.owner) continue;
          const m1 = byName[u.owner], m2 = byName[u2.owner];
          if (!floorOk(m2, u.fl) || !floorOk(m1, u2.fl)) continue;
          unassign(u.owner, u.day, u.fl, u.sis);
          unassign(u2.owner, u2.day, u2.fl, u2.sis);
          let done = false;
          if (canTake(m2, u.day, u.sis)) {
            place(m2.name, u.day, u.fl, u.sis);
            if (canTake(m1, u2.day, u2.sis)) {
              place(m1.name, u2.day, u2.fl, u2.sis);
              const J = objective();
              if (J > curJ + 1e-9) { curJ = J; improved = true; done = true; }
              else { unassign(m1.name, u2.day, u2.fl, u2.sis); unassign(m2.name, u.day, u.fl, u.sis); }
            } else unassign(m2.name, u.day, u.fl, u.sis);
          }
          if (!done) { place(u.owner, u.day, u.fl, u.sis); place(u2.owner, u2.day, u2.fl, u2.sis); }
        }
      }
      if (!improved) break;
    }

    if (curJ > globalBestJ + 1e-9) { globalBestJ = curJ; globalBestSnap = snapshot(); }
  }
  restore(globalBestSnap);
  fillBudget();

  // ===== 최종 보수: 필수칸 빈 곳은 묶음 제한 완화해서라도 채움 =====
  for (const day of DAYS) for (let si = 0; si < N; si++) for (const fl of REQUIRED) {
    if (schedule[day][si][fl] !== null) continue;
    const cands = seedSort(members.filter((m) => floorOk(m, fl) && canTake(m, day, [si], { maxRuns: 9 })), fl, shiftOf(si));
    if (cands.length) place(cands[0].name, day, fl, [si]);
  }

  return schedule;
}
