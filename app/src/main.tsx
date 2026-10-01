import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as actions from "./state/actions.ts";
import { store } from "./state/store.ts";
import { App } from "./ui/App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
void actions.start();
if (import.meta.env.DEV) (globalThis as unknown as { __rewire: unknown }).__rewire = { store, actions };
