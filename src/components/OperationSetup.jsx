import { useState } from "react";
import { PRESETS } from "../constants";
import { buildTimeSlots } from "../utils";
import { defaultTitle, defaultEffectiveDate } from "../exporter";

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
  const updateText = (field, val) => { setPreset(null); setLocalCfg(prev => ({ ...prev, [field]: val })); };
  const applyPreset = key => {
    setPreset(key);
    // 제목·시행일은 운영 시간 프리셋과 무관하므로 덮어쓰지 않는다
    const p = { ...PRESETS[key], slotMins: 60, title: localCfg.title, effectiveDate: localCfg.effectiveDate };
    p.firstSlotMins = calcFirstSlot(p.openMin);
    setLocalCfg(p);
  };

  return (
    <div className="step-card" style={{ maxWidth: 680 }}>
      <h2 className="step-title">운영 설정</h2>
      <div className="preset-row">
        {Object.entries(PRESETS).map(([key, p]) => (
          <button key={key} className={`preset-btn ${preset === key ? "active" : ""}`} onClick={() => applyPreset(key)}>{p.label}</button>
        ))}
        {!preset && <span className="preset-custom-tag">직접 지정함</span>}
      </div>
      <div className="cfg-grid">
        <div className="cfg-section">
          <div className="cfg-section-title">운영 시간</div>
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
              <span className="cfg-colon" style={{ fontSize: 11, color: "var(--ink-2)" }}>(자동)</span>
            </div>
          </div>
        </div>
        <div className="cfg-section">
          <div className="cfg-section-title">근로 한도</div>
          <div className="cfg-row">
            <label className="cfg-label" title="인원별로 20/40시간을 따로 정할 수 있고, 이 값은 정하지 않은 사람에게 적용됩니다">기본 주 근무시간</label>
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
      <div className="cfg-bottom">
      <div className="cfg-section" style={{ marginTop: 16 }}>
        <div className="cfg-section-title">엑셀 제목줄</div>
        {[
          { field: "title", label: "제목", ph: defaultTitle() },
          { field: "effectiveDate", label: "시행일", ph: defaultEffectiveDate() },
        ].map(({ field, label, ph }) => (
          <div key={field} className="cfg-row">
            <label className="cfg-label">{label}</label>
            <input type="text" className="cfg-text" placeholder={ph}
              value={localCfg[field] ?? ""} onChange={e => updateText(field, e.target.value)} />
          </div>
        ))}
        <div className="cfg-hint">비워두면 오늘 날짜로 자동 작성됩니다 (예: {defaultTitle()})</div>
      </div>
      <div className="preview-section">
        <div className="preview-title">시간 슬롯 미리보기</div>
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
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
        <button className="btn-next" onClick={() => onNext(localCfg)}>다음: 인원 등록 →</button>
      </div>
    </div>
  );
}
