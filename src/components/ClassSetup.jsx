import { useState } from "react";
import { DAYS_KR } from "../constants";

export default function ClassSetup({ members, setMembers, onNext, onBack }) {
  const [selected, setSelected] = useState(members[0]?.name || "");
  const member = members.find(m => m.name === selected);

  const addClass    = () => setMembers(prev => prev.map(m => m.name !== selected ? m : { ...m, classes: [...(m.classes || []), { day: "월", startHour: 9, startMin: 0, endHour: 10, endMin: 0 }] }));
  const updateClass = (idx, field, value) => setMembers(prev => prev.map(m => m.name !== selected ? m : { ...m, classes: (m.classes || []).map((c, i) => i !== idx ? c : { ...c, [field]: field === "day" ? value : (parseInt(value) || 0) }) }));
  const removeClass = idx => setMembers(prev => prev.map(m => m.name !== selected ? m : { ...m, classes: (m.classes || []).filter((_, i) => i !== idx) }));

  return (
    <div className="step-card">
      <h2 className="step-title">② 수업시간 입력</h2>
      <p className="step-desc">수업 시간은 자동 배치 제외 및 대체 인원 계산에 사용됩니다.</p>
      <div className="tab-row">
        {members.map(m => (
          <button key={m.name} className={`tab-btn ${selected === m.name ? "active" : ""}`}
            style={selected === m.name ? { borderBottom: `3px solid ${m.color}`, color: m.color } : {}}
            onClick={() => setSelected(m.name)}>{m.name}</button>
        ))}
      </div>
      {member && (
        <div className="class-list">
          {(member.classes || []).length === 0 && <p className="no-class">등록된 수업이 없습니다.</p>}
          {(member.classes || []).map((cls, idx) => (
            <div key={idx} className="class-row">
              <select className="sel" value={cls.day} onChange={e => updateClass(idx, "day", e.target.value)}>
                {DAYS_KR.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input type="number" className="time-inp" min={6} max={23} value={cls.startHour} onChange={e => updateClass(idx, "startHour", e.target.value)} />
              <span className="time-sep">:</span>
              <input type="number" className="time-inp" min={0} max={59} step={10} value={cls.startMin} onChange={e => updateClass(idx, "startMin", e.target.value)} />
              <span className="time-sep">~</span>
              <input type="number" className="time-inp" min={6} max={23} value={cls.endHour} onChange={e => updateClass(idx, "endHour", e.target.value)} />
              <span className="time-sep">:</span>
              <input type="number" className="time-inp" min={0} max={59} step={10} value={cls.endMin} onChange={e => updateClass(idx, "endMin", e.target.value)} />
              <button className="remove-btn" onClick={() => removeClass(idx)}>✕</button>
            </div>
          ))}
          <button className="btn-add-class" onClick={addClass}>+ 수업 추가</button>
        </div>
      )}
      <div className="nav-row">
        <button className="btn-back" onClick={onBack}>← 뒤로</button>
        <button className="btn-next" onClick={onNext}>시간표 생성 →</button>
      </div>
    </div>
  );
}
