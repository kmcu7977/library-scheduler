import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ClassTimetablePage from "./components/ClassTimetablePage.jsx";
import SchedulePreviewPage from "./components/SchedulePreviewPage.jsx";

// #classes/class · #classes/free 로 열면 수업시간표만 있는 화면이 뜬다
// (수업시간표 창의 "🗗 새 탭"이 보고 있던 화면을 이 주소로 띄운다).
// #snapshot/0 은 보관해둔 버전의 근무표 미리보기 — 버전 보관함의 "🗗 미리보기"가 연다.
// 라우터를 들이는 대신 해시 하나로 갈라놓는다 — 화면이 둘뿐이고 주소를 옮겨 다닐 일도 없다
const route = window.location.hash.replace(/^#\/?/, "").split("/")[0];

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {route === "classes" ? <ClassTimetablePage />
      : route === "snapshot" ? <SchedulePreviewPage />
      : <App />}
  </StrictMode>
);
