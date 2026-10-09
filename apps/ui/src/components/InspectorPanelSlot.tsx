"use client";

import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type InspectorPanelHostContextValue = {
  host: HTMLElement | null;
  setHost: (host: HTMLElement | null) => void;
};

const InspectorPanelHostContext = createContext<InspectorPanelHostContextValue>({
  host: null,
  setHost: () => {},
});

export function InspectorPanelSlotProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  return (
    <InspectorPanelHostContext.Provider value={{ host, setHost }}>
      {children}
    </InspectorPanelHostContext.Provider>
  );
}

export function InspectorPanelHost() {
  const { setHost } = useContext(InspectorPanelHostContext);
  const registerHost = useCallback(
    (host: HTMLElement | null) => setHost(host),
    [setHost],
  );

  return <div ref={registerHost} className="hidden lg:contents" />;
}

export function InspectorPanelSlot({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const { host } = useContext(InspectorPanelHostContext);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const updateIsDesktop = () => setIsDesktop(mediaQuery.matches);
    updateIsDesktop();
    mediaQuery.addEventListener("change", updateIsDesktop);
    return () => mediaQuery.removeEventListener("change", updateIsDesktop);
  }, []);

  if (enabled && isDesktop && host) {
    return createPortal(children, host);
  }

  return <>{children}</>;
}
