import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import "@/index.css";
import "@/fonts.css";

const container = document.getElementById("app-root");
if (!container) throw new Error("#app-root not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
