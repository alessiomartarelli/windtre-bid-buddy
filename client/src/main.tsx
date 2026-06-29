import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Rete di sicurezza per le schede aperte PRIMA di un deploy: quando un
// chunk hashato non esiste più (build nuova, vecchi chunk rimossi) Vite
// emette `vite:preloadError`. Senza intervento l'utente vedrebbe la pagina
// bianca con "Failed to fetch dynamically imported module". Ricarichiamo
// una sola volta (flag in sessionStorage) per prendere il nuovo manifest
// ed evitare loop di reload se l'errore non dipende dal deploy.
const RELOAD_FLAG = "cj:chunk-reload";
window.addEventListener("vite:preloadError", (event) => {
  if (sessionStorage.getItem(RELOAD_FLAG)) return;
  event.preventDefault();
  sessionStorage.setItem(RELOAD_FLAG, "1");
  window.location.reload();
});
window.addEventListener("load", () => {
  sessionStorage.removeItem(RELOAD_FLAG);
});

createRoot(document.getElementById("root")!).render(<App />);
