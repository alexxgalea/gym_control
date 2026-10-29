import "@fontsource-variable/inter";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./App";
import { initTheme } from "./design/theme";
import "./index.css";
import { createQueryClient } from "./queryClient";

const queryClient = createQueryClient();
initTheme(); // tema ținută minte, aplicată înainte de prima randare

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* animațiile respectă setarea de sistem „Reduce motion” */}
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/admin">
          <AppRoutes />
        </BrowserRouter>
      </QueryClientProvider>
    </MotionConfig>
  </StrictMode>,
);
