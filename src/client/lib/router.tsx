import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from "react";
import { setActiveSession } from "../api";

/** Addresses look like /agents/w1%3Ap1 for the default Herdr session and /s/<session>/agents/... for a named one. */
function parse(pathname: string): { session: string | null; path: string } {
  const m = /^\/s\/([^/]+)(\/.*)?$/u.exec(pathname);
  if (!m) return { session: null, path: pathname };
  return { session: decodeURIComponent(m[1]), path: m[2] ?? "/" };
}

const prefix = (session: string | null) => (session ? `/s/${encodeURIComponent(session)}` : "");

interface Ctx { path: string; session: string | null; go: (to: string, session?: string | null) => void }
const RouterContext = createContext<Ctx>({ path: "/", session: null, go: () => undefined });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(() => parse(window.location.pathname));
  setActiveSession(location.session);
  useEffect(() => {
    const onPop = () => setLocation(parse(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (to: string, session: string | null = location.session) => {
    const full = `${prefix(session)}${to === "/" && session ? "" : to}` || "/";
    if (full === window.location.pathname) return;
    window.history.pushState(null, "", full);
    setLocation(parse(full));
  };
  return <RouterContext.Provider value={{ ...location, go }}>{children}</RouterContext.Provider>;
}

export const useRoute = () => useContext(RouterContext);

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { path, session, go } = useRoute();
  const active = to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`);
  return (
    <a
      href={`${prefix(session)}${to === "/" && session ? "" : to}` || "/"}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        go(to);
      }}
      {...rest}
    />
  );
}
