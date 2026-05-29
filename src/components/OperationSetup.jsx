import { useState } from "react";
import { PRESETS } from "../constants";
import { buildTimeSlots } from "../utils";

export default function OperationSetup({ cfg, onNext }) {
  const [preset, setPreset] = useState(null);
  const calcFirstSlot = (openMin) => openMin === 0 ? 60 : 60 - openMin;
  const [localCfg, setLocalCfg] = useState({ ...cfg, slotMins: 60, firstSlotMins: calcFirstSlot(cfg.openMin) });
  const preview = buildTimeSlots(localCfg);
  const update = (field, val) => {
    setPreset(null);
    setLocalCfg(prev => {
      const next = { ...prev, [field]: Number(val) };
      if (field === "openMin") next.firstSlotMins = calcFirstSlot(Number(val));
      return next;
    });
  };
  const applyPreset = key => {
    setPreset(key);
    const p = { ...PRESETS[key], slotMins: 60 };
    p.firstSlotMins = calcFirstSlot(p.openMin);
    setLocalCfg(p);
  };

  return (
    <div className="step-card" style={{ maxWidth: 680 }}>
      <h2 className="step-title">⓪ 운영 설정</h2>
      <div className="preset-row">
        {Object.entries(PRESETS).map(([key, p]) => (
          <button key={key} className={`preset-btn ${preset === key ? "active" : ""}`} onClick={() => applyPreset(key)}>{p.label}</button>
        ))}
        {!preset && <span className="preset-custom-tag">✏️ 커스텀</span>}
      </div>
      <div className="cfg-grid">
        <div className="cfg-section">
          <div className="cfg-section-title">🕐 운영 시간</div>
          {[
            { label: "개관 시각", fH: "openHour", fM: "openMin" },
            { label: "폐관 시각", fH: "closeHour", fM: "closeMin" },
          ].map(({ label, fH, fM }) => (
            <div key={label} className="cfg-row">
              <label className="cfg-label">{label}</label>
              <div className="cfg-time-inputs">
                <input type="number" className="cfg-num" min={0} max={23} value={localCfg[fH]} onChange={e => update(fH, e.target.value)} />
                <span className="cfg-colon">시</span>
                {[0, 30].map(m => (
                  <button key={m}
                    className={`min-btn ${localCfg[fM] === m ? "active" : ""}`}
                    onClick={() => update(fM, m)}>
                    {String(m).padStart(2, "0")}분
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="cfg-row">
            <label className="cfg-label">첫 슬롯 길이</label>
            <div className="cfg-time-inputs">
              <span className="cfg-colon" style={{ fontWeight: 700 }}>{localCfg.firstSlotMins}분</span>
              <span className="cfg-colon" style={{ fontSize: 11, color: "#5a6480" }}>(자동)</span>
            </div>
          </div>
        </div>
        <div className="cfg-section">
          <div className="cfg-section-title">⏱ 근로 한도</div>
          <div className="cfg-row">
            <label className="cfg-label">주간 최대 시간</label>
            <div className="cfg-time-inputs">
              <input type="number" className="cfg-num wide" min={1} max={60} value={localCfg.maxWeeklyHours} onChange={e => update("maxWeeklyHours", e.target.value)} />
              <span className="cfg-colon">시간 / 주</span>
            </div>
          </div>
          <div className="cfg-row">
            <label className="cfg-label">일일 최대 시간</label>
            <div className="cfg-time-inputs">
              <input type="number" className="cfg-num wide" min={1} max={16} value={localCfg.maxDailyHours} onChange={e => update("maxDailyHours", e.target.value)} />
              <span className="cfg-colon">시간 / 일</span>
            </div>
          </div>
          <div className="cfg-summary">
            <div className="cfg-summary-item"><span>총 슬롯 수</span><strong>{preview.length}개</strong></div>
            <div className="cfg-summary-item">
              <span>운영 시간</span>
              <strong>{localCfg.openHour}:{String(localCfg.openMin).padStart(2,"0")} ~ {localCfg.closeHour}:{String(localCfg.closeMin).padStart(2,"0")}</strong>
            </div>
          </div>
        </div>
      </div>
      <div className="preview-section">
        <div className="preview-title">📋 시간 슬롯 미리보기</div>
        <div className="preview-slots">
          {preview.map((s, i) => (
            <div key={i} className="preview-slot">
              <span className="preview-idx">{i + 1}</span>
              <span className="preview-label">{s.label.replace("\n", " ")}</span>
              <span className="preview-hours">{s.hours}h</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
        <button className="btn-next" onClick={() => onNext(localCfg)}>다음: 인원 등록 →</button>
      </div>
    </div>
  );
}
