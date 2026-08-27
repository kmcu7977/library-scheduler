import { useEffect, useState } from "react";
import { SLOTS, AUTO_SLOT, makeSnapshot, normalizeSnapshots, fmtSavedAt, summarize } from "../snapshots";
import { loadSnapshots, saveSnapshot } from "../firebase";

// 보관해둔 버전을 새 탭에서 미리 본다 (근무표만, 읽기 전용).
// 칸마다 창 이름이 달라 여러 버전을 동시에 띄워 비교할 수 있다
export const openSnapshotTab = slot =>
  window.open(`${window.location.pathname}${window.location.search}#snapshot/${slot}`, "librarySnapshot-" + slot);

// 자동저장은 그대로 두고, 사서가 손으로 남기는 버전 3칸을 관리한다.
// 3칸이 다 차면 새로 만들지 않고 덮어쓸 칸을 직접 고르게 한다 — 오래된 걸 자동으로 지우면
// "어제 그 버전 어디 갔지"가 생긴다
export default function SnapshotPanel({ state, onRestore, onClose }) {
  const [snaps, setSnaps] = useState(null);   // [3칸] · null = 아직 불러오는 중
  const [auto, setAuto] = useState(null);     // 숨은 대피칸 (불러오기 직전 상태)
  const [form, setForm] = useState(null);     // { slot, name, desc } — 저장 입력 중
  const [ask, setAsk] = useState(null);       // 불러오기 확인 { snap, undo }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const reload = () => loadSnapshots()
    .then(raw => { setSnaps(normalizeSnapshots(raw)); setAuto(raw?.[AUTO_SLOT] || null); })
    .catch(() => setMsg("보관함을 불러오지 못했습니다."));

  useEffect(() => { reload(); }, []);

  const save = async () => {
    if (!form.name.trim()) { setMsg("이름을 입력해주세요."); return; }
    setBusy(true);
    const ok = await saveSnapshot(form.slot, makeSnapshot(state, form.name, form.desc));
    setBusy(false);
    if (!ok) { setMsg("저장하지 못했습니다. 잠시 후 다시 시도해주세요."); return; }
    setForm(null); setMsg("");
    reload();
  };

  const doLoad = async snap => {
    setBusy(true);
    // 불러오기 직전 상태를 숨은 칸에 대피시킨다 — 잘못 불러왔을 때 되돌릴 유일한 수단이다.
    // 대피가 실패하면 되돌릴 길이 없으므로 불러오기 자체를 멈춘다
    const parked = await saveSnapshot(AUTO_SLOT, makeSnapshot(state, "불러오기 직전 상태"));
    setBusy(false);
    if (!parked) { setMsg("직전 상태를 보관하지 못해 불러오기를 멈췄습니다."); setAsk(null); return; }
    onRestore(snap.data);
    onClose();
  };

  const startSave = slot => { setMsg(""); setForm({ slot, name: "", desc: "" }); };

  return (
    <div className="cell-popup-overlay" onClick={onClose}>
      <div className="cell-popup snap-modal" onClick={e => e.stopPropagation()}>
        <div className="class-modal-head">
          <h3 className="panel-title">버전 보관함</h3>
          <button className="btn-back" style={{ padding: "6px 14px" }} onClick={onClose}>닫기</button>
        </div>
        <p className="snap-lead">
          지금 상태를 통째로(운영설정·인원·수업·시간표·확정 표시) 3칸까지 남겨둘 수 있습니다.
          자동저장은 그대로 돌아가고, 여기 담아둔 건 불러오기 전까지 바뀌지 않습니다.
        </p>

        {msg && <p className="snap-msg">{msg}</p>}

        {snaps === null ? <p className="snap-lead">불러오는 중...</p> : (
          <div className="snap-grid">
            {snaps.map((snap, slot) => (
              <div key={slot} className={"snap-card" + (snap ? "" : " empty")}>
                <div className="snap-slot">칸 {slot + 1}</div>
                {form?.slot === slot ? (
                  <div className="snap-form">
                    {snap && <p className="snap-warn">이 칸의 «{snap.name}»이(가) 지워집니다.</p>}
                    <input className="cfg-text snap-input" autoFocus maxLength={30} placeholder="이름 (예: 1학기 확정본)"
                      value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                    <textarea className="cfg-text snap-input" rows={2} maxLength={120} placeholder="설명 (선택)"
                      value={form.desc} onChange={e => setForm(f => ({ ...f, desc: e.target.value }))} />
                    <div className="snap-actions">
                      <button className="btn-back" disabled={busy} onClick={save}>{busy ? "저장 중..." : "저장"}</button>
                      <button className="btn-back" onClick={() => { setForm(null); setMsg(""); }}>취소</button>
                    </div>
                  </div>
                ) : snap ? (
                  <>
                    <div className="snap-name">{snap.name}</div>
                    <div className="snap-time">{fmtSavedAt(snap.savedAt)}</div>
                    {snap.desc && <div className="snap-desc">{snap.desc}</div>}
                    <div className="snap-sum">{summarize(snap)}</div>
                    <div className="snap-actions">
                      <button className="btn-back snap-primary" onClick={() => setAsk({ snap })}>불러오기</button>
                      <button className="btn-back" onClick={() => openSnapshotTab(slot)}>미리보기</button>
                      <button className="btn-back" onClick={() => startSave(slot)}>덮어쓰기</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="snap-empty">비어 있음</div>
                    <div className="snap-actions">
                      <button className="btn-back snap-primary" onClick={() => startSave(slot)}>여기에 저장</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {auto && (
          <p className="snap-undo">
            마지막으로 불러오기 직전 상태가 {fmtSavedAt(auto.savedAt)}에 자동 보관되어 있습니다.
            <button className="btn-back" style={{ marginLeft: 8, padding: "4px 12px" }}
              onClick={() => setAsk({ snap: auto, undo: true })}>직전 상태로 되돌리기</button>
          </p>
        )}

        {ask && (
          <div className="cell-popup-overlay" onClick={() => setAsk(null)}>
            <div className="cell-popup" onClick={e => e.stopPropagation()} style={{ maxWidth: 340, textAlign: "center" }}>
              <p className="panel-title" style={{ marginBottom: 10 }}>
                {ask.undo ? "직전 상태로 되돌리기" : "이 버전 불러오기"}
              </p>
              <p className="popup-title" style={{ marginBottom: 18 }}>
                지금 화면이 <b>«{ask.snap.name}»</b>({fmtSavedAt(ask.snap.savedAt)})으로 바뀝니다.<br />
                <span style={{ fontSize: 12, color: "#607d8b" }}>
                  운영설정·인원·수업·시간표가 함께 바뀌며, 지금 상태는 되돌릴 수 있게 자동으로 보관됩니다.
                </span>
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button className="btn-back" onClick={() => setAsk(null)}>취소</button>
                <button className="btn-back snap-primary" disabled={busy} onClick={() => doLoad(ask.snap)}>
                  {busy ? "보관 중..." : "불러오기"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
