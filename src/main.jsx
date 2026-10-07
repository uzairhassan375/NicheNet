import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Privacy from "./Privacy.jsx";
import "./styles.css";

const Page = window.location.pathname === "/privacy" ? Privacy : App;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
