import { useState, useMemo } from "react";
import { DAYS } from "../constants";
import { memberStats } from "../stats";

const WEEK_OPTIONS = [1, 2, 4];
const fmt = h => (Number.isInteger(h) ? h : h.toFixed(1));

// 학생별 근무시간 집계표. 시간표가 한 주 반복 구조라 기간 합계는 주간 × 주 수로 낸다
export default function StatsPanel({ members, schedule, timeSlots, cfg, onClose }) {
  const [weeks, setWeeks] = useState(4);
  const { rows, total } = useMemo(
    () => memberStats(members, schedule, timeSlots, cfg, weeks),
    [members, schedule, timeSlots, cfg, weeks]
  );
  const maxDay = Math.max(1, ...DAYS.map(d => total.byDay[d]));

  return (
    <div className="cell-popup-overlay" onClick={onClose}>
      <div className="cell-popup class-modal" onClick={e => e.stopPropagation()}>
        <div className="class-modal-head">
          <h3 style={{ margin: 0, fontSize: 15, color: "#1976d2" }}>📊 근무시간 통계</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="mode-switch">
              {WEEK_OPTIONS.map(w => (
                <button key={w} className={weeks === w ? "on" : ""} onClick={() => setWeeks(w)}>{w}주</button>
              ))}
            </div>
            <button className="btn-back" style={{ padding: "6px 14px" }} onClick={onClose}>닫기</button>
          </div>
        </div>

        <div className="stat-cards">
          <div className="stat-card">
            <span>전체 인원</span>
            <strong>{rows.length}명</strong>
          </div>
          <div className="stat-card">
            <span>주간 총 근무</span>
            <strong>{fmt(total.week)}h</strong>
            <em>한도 {fmt(total.cap)}h</em>
          </div>
          <div className="stat-card accent">
            <span>{weeks}주 총 근무</span>
            <strong>{fmt(total.period)}h</strong>
            <em>한도 {fmt(total.capPeriod)}h</em>
          </div>
          <div className="stat-card">
            <span>저녁({17}시~) 비중</span>
            <strong>{total.week ? Math.round((total.evening / total.week) * 100) : 0}%</strong>
            <em>{fmt(total.evening)}h</em>
          </div>
        </div>

        <div className="table-wrap">
          <table className="sched-table stat-table">
            <thead>
              <tr>
                <th className="th-time" style={{ width: 90 }}>이름</th>
                {DAYS.map(d => <th key={d} className="th-floor">{d}</th>)}
                <th className="th-day">1주</th>
                <th className="th-day">{weeks}주</th>
                <th className="th-floor">한도 대비</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const pct = r.cap ? Math.round((r.week / r.cap) * 100) : 0;
                const over = r.week > r.cap + 1e-9;
                return (
                  <tr key={r.member.name}>
                    <td className="td-time" style={{ color: r.member.color, fontWeight: 700, textAlign: "left", paddingLeft: 10 }}>
                      {r.member.name}
                      <span className="stat-sub">{r.days}일 출근</span>
                    </td>
                    {DAYS.map(d => (
                      <td key={d} className={`stat-num ${r.byDay[d] ? "" : "zero"}`}>
                        {r.byDay[d] ? fmt(r.byDay[d]) : "·"}
                      </td>
                    ))}
                    <td className="stat-num strong">{fmt(r.week)}</td>
                    <td className="stat-num strong">{fmt(r.period)}</td>
                    <td className="stat-num">
                      <div className="stat-bar"><i style={{ width: `${Math.min(pct, 100)}%`, background: over ? "#e53935" : r.member.color }} /></div>
                      <span className={over ? "stat-over" : ""}>{fmt(r.week)}/{fmt(r.cap)}h</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="td-time" style={{ fontWeight: 700, textAlign: "left", paddingLeft: 10 }}>합계</td>
                {DAYS.map(d => (
                  <td key={d} className="stat-num strong">
                    {fmt(total.byDay[d])}
                    <div className="stat-bar sm"><i style={{ width: `${(total.byDay[d] / maxDay) * 100}%`, background: "#1976d2" }} /></div>
                  </td>
                ))}
                <td className="stat-num strong">{fmt(total.week)}</td>
                <td className="stat-num strong">{fmt(total.period)}</td>
                <td className="stat-num">{fmt(total.cap)}h 중</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="class-foot">
          시간표는 월~금 한 주가 반복되는 구조라 <b>{weeks}주 합계 = 주간 합계 × {weeks}</b>로 계산합니다.
          공휴일·휴관일은 반영되지 않습니다.
        </p>
      </div>
    </div>
  );
}
