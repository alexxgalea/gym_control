import "@fontsource-variable/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { initTheme } from "@/design/theme";
import "@/index.css";
import { EmployeeRoutes } from "./App";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
initTheme(); // tema urmează sistemul, sau alegerea ținută minte în browser

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <EmployeeRoutes />
        </BrowserRouter>
      </QueryClientProvider>
    </MotionConfig>
  </StrictMode>,
);
