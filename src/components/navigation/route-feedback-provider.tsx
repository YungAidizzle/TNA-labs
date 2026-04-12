"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

type RouteFeedbackContextValue = {
  isNavigating: boolean;
  label: string | null;
  startNavigation: (label?: string | null) => void;
};

const RouteFeedbackContext = createContext<RouteFeedbackContextValue | null>(null);

const DEFAULT_LABEL = "Loading next surface";

export function RouteFeedbackProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<{ active: boolean; label: string | null }>({
    active: false,
    label: null,
  });

  useEffect(() => {
    setState((current) => {
      if (!current.active) {
        return current;
      }

      return {
        active: false,
        label: null,
      };
    });
  }, [pathname]);

  const value = useMemo<RouteFeedbackContextValue>(
    () => ({
      isNavigating: state.active,
      label: state.label,
      startNavigation: (label) => {
        setState({
          active: true,
          label: label?.trim() || DEFAULT_LABEL,
        });
      },
    }),
    [state.active, state.label],
  );

  return (
    <RouteFeedbackContext.Provider value={value}>
      <div
        aria-hidden="true"
        className="route-feedback-shell"
        data-active={state.active ? "true" : "false"}
      >
        <div className="route-feedback-bar" />
      </div>
      <div
        aria-hidden="true"
        className="route-feedback-pill"
        data-active={state.active ? "true" : "false"}
      >
        <span className="route-feedback-dot" />
        <span>{state.label ?? DEFAULT_LABEL}</span>
      </div>
      <span className="sr-only" aria-live="polite">
        {state.active ? state.label ?? DEFAULT_LABEL : "Navigation idle"}
      </span>
      {children}
    </RouteFeedbackContext.Provider>
  );
}

export function useRouteFeedback() {
  const context = useContext(RouteFeedbackContext);

  if (!context) {
    throw new Error("useRouteFeedback must be used within RouteFeedbackProvider.");
  }

  return context;
}
