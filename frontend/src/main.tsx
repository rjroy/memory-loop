/**
 * Memory Loop Frontend
 *
 * React application providing:
 * - Vault selection interface
 * - Note capture mode for quick thought entry
 * - Discussion mode for AI conversations
 * - Real-time tool transparency display
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
