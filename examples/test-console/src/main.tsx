import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { init } from "./console-store.ts";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
void init();
