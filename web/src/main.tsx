import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

function ban(): never {
  throw new Error();
}

createRoot(document.getElementById("root") ?? ban()).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
