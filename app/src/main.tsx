import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { start } from "./state/actions.ts";
import { App } from "./ui/App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
void start();
