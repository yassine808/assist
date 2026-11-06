import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AppActiveProvider, useAppActive } from "./useAppActive";

function Probe() {
  const active = useAppActive();
  return <span data-testid="active">{String(active)}</span>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.classList.remove("app-inactive");
});

describe("app activity", () => {
  it("pauses when the window loses focus and resumes when it returns", () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    render(
      <AppActiveProvider>
        <Probe />
      </AppActiveProvider>
    );

    expect(screen.getByTestId("active").textContent).toBe("true");
    expect(document.documentElement.classList.contains("app-inactive")).toBe(false);

    hasFocus.mockReturnValue(false);
    fireEvent.blur(window);

    expect(screen.getByTestId("active").textContent).toBe("false");
    expect(document.documentElement.classList.contains("app-inactive")).toBe(true);

    hasFocus.mockReturnValue(true);
    fireEvent.focus(window);

    expect(screen.getByTestId("active").textContent).toBe("true");
    expect(document.documentElement.classList.contains("app-inactive")).toBe(false);
  });
});
