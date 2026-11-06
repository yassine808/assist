import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initAppearance } from "./lib/appearance";
import { installSmoothScroll } from "./lib/smoothScroll";
import "./index.css";
import "./styles/card-glow.css";
import "./styles/toast.css";
import "./styles/sortable.css";

// Apply the saved theme + card scale before the first paint (no flash).
initAppearance();
// Inertial wheel scrolling for every pane (opt out per element with data-native-scroll).
installSmoothScroll();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
