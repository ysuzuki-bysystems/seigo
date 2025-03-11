import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import App from "./app/App.tsx";

function ban(): never {
  throw new Error("ban");
}

createRoot(document.getElementById("root") ?? ban()).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
