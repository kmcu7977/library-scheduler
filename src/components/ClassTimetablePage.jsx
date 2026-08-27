import { useEffect, useState } from "react";
import { PRESETS } from "../constants";
import { subscribeToFirebase } from "../firebase";
import { ClassTimetableView, PANES } from "./ClassTimetable";
import "../App.css";

// 새 탭(#classes/class · #classes/free)에서 수업시간표만 크게 본다.
// 이 화면을 탭 두 개로 띄워 좌우로 붙여 놓고 쓰라고 만들었다.
// 본 탭과 값을 주고받지 않고 Firebase를 직접 구독한다: 사서가 본 탭에서 수업을 고치면
// 이 탭도 새로고침 없이 따라오고, 두 탭의 내용이 갈라질 일이 없다.
export default function ClassTimetablePage() {
  const [state, setState] = useState({ status: "loading" });
  // 어느 화면인지는 주소가 정한다 (#classes/free). 탭 두 개가 서로 다른 화면으로 열리는 근거
  const [mode, setMode] = useState(() => (window.location.hash.split("/")[1] === "free" ? "free" : "class"));

  // 작업표시줄에서 두 탭이 구분되도록. 탭 안에서 화면을 바꾸면 제목도 따라간다
  useEffect(() => { document.title = PANES[mode].tab; }, [mode]);

  // 구독은 화면 전환과 무관하다 — 같은 효과에 묶으면 버튼 한 번에 재구독이 일어난다
  useEffect(() => subscribeToFirebase(
    data => setState({ status: "done", data }),
    () => setState({ status: "error" }),
  ), []);

  if (state.status !== "done") return (
    <div className="class-page-msg" style={{ color: state.status === "error" ? "var(--stamp)" : "var(--navy)" }}>
      {state.status === "error" ? "Firebase에 연결하지 못했습니다." : "불러오는 중..."}
      {state.status === "error" && (
        <button className="btn-back" style={{ marginTop: 14 }} onClick={() => window.location.reload()}>다시 시도</button>
      )}
    </div>
  );

  // Firebase는 배열을 객체로 되돌리기도 한다 (App.jsx가 하는 정규화와 같은 이유)
  const raw = state.data?.members;
  const members = Array.isArray(raw) ? raw : Object.values(raw || {});
  const cfg = state.data?.cfg || PRESETS.semester;

  return (
    <div className="app class-page">
      <header className="app-header">
        <div className="header-accent" />
        <div className="header-top">
          <div>
            <p className="masthead-eyebrow">학생 수업시간표</p>
            <h1 className="app-title">{PANES[mode].title}</h1>
          </div>
          <span className="save-indicator">시간표 탭에서 수업을 고치면 여기도 바로 바뀝니다</span>
        </div>
      </header>
      <main className="app-main">
        <div className="step-card wide">
          {members.length === 0
            ? <p style={{ fontSize: 13, color: "var(--ink-2)" }}>등록된 인원이 없습니다. 시간표 탭에서 인원을 먼저 등록해주세요.</p>
            : <ClassTimetableView members={members} cfg={cfg} mode={mode} setMode={setMode} />}
        </div>
      </main>
    </div>
  );
}
