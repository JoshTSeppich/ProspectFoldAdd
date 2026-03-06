import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ProspectCrafter from "./prospect-crafter.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ProspectCrafter />
  </StrictMode>
);
