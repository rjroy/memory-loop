/**
 * Memory Loop Frontend
 *
 * React application providing:
 * - Vault selection interface
 * - Note capture mode for quick thought entry
 * - Discussion mode for AI conversations
 * - Real-time tool transparency display
 */

import React from "react";
import ReactDOM from "react-dom/client";

function App() {
  return (
    <div>
      <h1>Memory Loop</h1>
      <p>Mobile-friendly vault interface - placeholder</p>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
