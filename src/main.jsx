import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import * as bridge from "./bridge";

// Expose bridge for E2E tests to extract debug logs easily
window.__ZEUS_BRIDGE__ = bridge;

ReactDOM.createRoot(document.getElementById("root")).render(
  <App />
);