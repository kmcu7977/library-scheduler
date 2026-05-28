import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // ⚠️ 레포 이름과 반드시 일치시켜야 합니다
  base: "/library-scheduler/",
});
