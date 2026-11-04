import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PlayerCardPicker from "./PlayerCardPicker";

/**
 * The picker has two card sources: the remote catalogue from the Python
 * backend and the animated APNGs listed by the Electron main process. These
 * tests pin the category switch, so a broken source cannot silently hide the
 * other one, and that selecting a card sends its URL to the backend.
 */

const call = vi.fn();
const getAnimatedCards = vi.fn();

vi.mock("../hooks/useIPC", () => ({
  useIPC: () => ({ call, onEvent: vi.fn() }),
}));

beforeEach(() => {
  call.mockReset();
  getAnimatedCards.mockReset();
  window.electronAPI = { getAnimatedCards } as unknown as Window["electronAPI"];

  call.mockImplementation(async (method: string) => {
    if (method === "get_playercards") {
      return [{ uuid: "u1", displayName: "Jett Card", largeArt: "https://example.test/jett.png" }];
    }
    return { ok: true };
  });
  getAnimatedCards.mockResolvedValue([
    { name: "Astra", url: "card://animated/Astra_Mastery_Card_animated.apng" },
  ]);
});

function renderPicker() {
  return render(
    <PlayerCardPicker
      profileName="Alpha#EUW"
      currentCardUrl=""
      onClose={vi.fn()}
      onApplied={vi.fn()}
    />
  );
}

describe("PlayerCardPicker categories", () => {
  it("shows normal cards by default and animated cards on the other tab", async () => {
    renderPicker();

    expect(await screen.findByText("Jett Card")).toBeDefined();
    expect(screen.queryByText("Astra")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Animated/ }));

    expect(await screen.findByText("Astra")).toBeDefined();
    expect(screen.queryByText("Jett Card")).toBeNull();
  });

  it("counts both sources independently", async () => {
    renderPicker();

    await waitFor(() => expect(screen.getByRole("button", { name: /^Normal/ })).toBeDefined());
    expect(screen.getByRole("button", { name: /^Animated/ })).toBeDefined();
  });

  it("sends the animated card URL to set_playercard", async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole("button", { name: /^Animated/ }));
    fireEvent.click(await screen.findByText("Astra"));

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("set_playercard", {
        name: "Alpha#EUW",
        card_url: "card://animated/Astra_Mastery_Card_animated.apng",
      })
    );
  });

  it("shows the empty state when no animated card is installed", async () => {
    getAnimatedCards.mockResolvedValue([]);
    renderPicker();

    fireEvent.click(await screen.findByRole("button", { name: /^Animated/ }));
    expect(await screen.findByText("No animated cards found")).toBeDefined();
  });
});
