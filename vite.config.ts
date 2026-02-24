import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync, existsSync } from "fs";

export default defineConfig({
  build: {
    target: "es2017",
    outDir: "dist",
    emptyOutDir: true,

    // ✅ 플러그인 메인만 번들링 (단일 input)
    rollupOptions: {
      input: resolve(__dirname, "src/code.ts"),
      output: {
        format: "iife",
        entryFileNames: "code.js",
      },
    },
  },

  // ✅ 빌드가 끝난 후 ui.html을 dist로 복사
  plugins: [
    {
      name: "copy-ui-html",
      closeBundle() {
        if (!existsSync("dist")) mkdirSync("dist");
        copyFileSync("src/ui.html", "dist/ui.html");
        // ui.ts를 쓰고 있으면, ui.ts는 별도 번들이 필요함(아래 2번 참고)
      },
    },
  ],
});