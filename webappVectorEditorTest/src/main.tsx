import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { initClipper } from "./geometry/clipperSubtract";

import "./styles.css";

void (async () => {
  await initClipper().catch(() => {
    /* room subdivision falls back to single shell; extrude still loads WASM on demand */
  });
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
})();
