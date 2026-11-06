import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AppActiveProvider } from "./useAppActive";
import { useAppActive } from "./appActiveContext";

function Probe() {
  const active = useAppActive();
  return <span data-testid="active">{String(active)}</span>;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  fireEvent(document, new Event("visibilitychange"));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.classList.remove("app-inactive");
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

describe("app activity", () => {
  it("keeps running when the window merely loses focus", () => {
    setVisibility("visible");
    render(
      <AppActiveProvider>
        <Probe />
      </AppActiveProvider>
    );

    expect(screen.getByTestId("active").textContent).toBe("true");

    // Another app is focused but the RiotSwitcher window is still on screen.
    fireEvent.blur(window);

    expect(screen.getByTestId("active").textContent).toBe("true");
    expect(document.documentElement.classList.contains("app-inactive")).toBe(false);
  });

  it("pauses only when the window is hidden or completely covered", () => {
    setVisibility("visible");
    render(
      <AppActiveProvider>
        <Probe />
      </AppActiveProvider>
    );

    expect(screen.getByTestId("active").textContent).toBe("true");

    setVisibility("hidden");

    expect(screen.getByTestId("active").textContent).toBe("false");
    expect(document.documentElement.classList.contains("app-inactive")).toBe(true);

    setVisibility("visible");

    expect(screen.getByTestId("active").textContent).toBe("true");
    expect(document.documentElement.classList.contains("app-inactive")).toBe(false);
  });
});
