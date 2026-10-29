import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { server } from "./server";

// În teste animațiile sunt oprite (ca și cum sistemul ar cere „Reduce motion”).
MotionGlobalConfig.skipAnimations = true;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  // jsdom nu are matchMedia; simulăm un sistem cu „Reduce motion” activ.
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
