import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Profile } from "../types/profile";

/**
 * Regression: choosing a new playercard in the Customize picker must replace
 * the art on the lobby card as soon as `set_playercard` resolves. The picker
 * used to close and call `onApplied`, but nothing proved the grid actually
 * re-rendered with the new `player_card_bg`.
 */

const OLD_CARD = "card://animated/Chamber_Mastery_Card_animated.apng";
const NEW_CARD = "https://media.valorant-api.com/playercards/new/largeart.png";

const { callMock, onEventMock } = vi.hoisted(() => ({
  callMock: vi.fn(),
  onEventMock: vi.fn(),
}));

vi.mock("../hooks/useIPC", () => ({
  useIPC: () => ({ call: callMock, onEvent: onEventMock }),
}));

import HomeView from "./HomeView";

function makeProfile(card: string): Profile {
  return {
    profile_name: "Alpha#EUW",
    description: "",
    valorant_puuid: "puuid-alpha",
    valorant_region: "eu",
    valorant_in_game_name: "Alpha#EUW",
    valorant_data: {
      player_card_bg: card,
      tier: 12,
      rr: 40,
      wins: 3,
      losses: 2,
    } as Profile["valorant_data"],
    is_running: false,
  };
}

describe("HomeView playercard change", () => {
  let card = OLD_CARD;

  beforeEach(() => {
    card = OLD_CARD;
    callMock.mockReset();
    onEventMock.mockReset();
    onEventMock.mockReturnValue(() => undefined);
    callMock.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === "get_profiles") return [makeProfile(card)];
      if (method === "get_playercards") {
        return [{ uuid: "new", displayName: "New Card", largeArt: NEW_CARD }];
      }
      if (method === "set_playercard") {
        card = String(params?.card_url ?? "");
        return { ok: true };
      }
      return null;
    });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getAnimatedCards: async () => [],
    };
  });

  it("shows the newly picked card on the lobby card", async () => {
    render(<HomeView />);

    const art = await waitFor(() => {
      const img = document.querySelector<HTMLImageElement>("img.lobby-art");
      expect(img?.getAttribute("src")).toBe(OLD_CARD);
      return img!;
    });
    expect(art).toBeTruthy();

    fireEvent.click(screen.getByTitle("Customize playercard"));
    fireEvent.click(screen.getByRole("button", { name: /^normal/i }));
    // The backdrop and panel are role="button" too, so target the tile itself.
    fireEvent.click((await screen.findByAltText("New Card")).closest("button")!);

    await waitFor(() =>
      expect(document.querySelector<HTMLImageElement>("img.lobby-art")?.getAttribute("src")).toBe(NEW_CARD),
    );
  });

  it("keeps the profiles toolbar pinned and frosts it only once the grid is underneath", async () => {
    const pane = document.createElement("div");
    pane.className = "view-pane";
    // jsdom has no layout, so drive the scroll position the pane exposes.
    let top = 0;
    Object.defineProperty(pane, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = v;
      },
    });
    document.body.appendChild(pane);

    render(<HomeView />, { container: pane });
    const head = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("header.profiles-head");
      expect(el).not.toBeNull();
      return el!;
    });

    // At rest the page keeps its flat look.
    expect(head.classList.contains("is-stuck")).toBe(false);

    top = 180;
    fireEvent.scroll(pane);
    expect(head.classList.contains("is-stuck")).toBe(true);

    top = 0;
    fireEvent.scroll(pane);
    expect(head.classList.contains("is-stuck")).toBe(false);

    pane.remove();
  });
});
