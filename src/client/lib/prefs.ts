import { useCallback, useEffect, useState } from "react";

const KEY = "hcc.hideOtherPanes";

function read(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** Hides panes that are not Codex or Claude sessions (custom consoles, shells). Per browser; Herdr is untouched. */
export function useHideOtherPanes(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const sync = () => setValue(read());
    window.addEventListener("hcc-prefs", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("hcc-prefs", sync); window.removeEventListener("storage", sync); };
  }, []);
  const set = useCallback((next: boolean) => {
    try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* optional */ }
    setValue(next);
    window.dispatchEvent(new Event("hcc-prefs"));
  }, []);
  return [value, set];
}
