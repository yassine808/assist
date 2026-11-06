import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import ProfileCard from "./ProfileCard";
import { AppActiveProvider } from "../hooks/useAppActive";
import type { Profile } from "../types/profile";

/**
 * Regression for "I changed the playercard and the new one never showed up".
 *
 * The lobby art waits for `load` behind a shimmer (`.is-charging` is
 * `opacity: 0`). Readiness used to be a boolean reset in an effect keyed on the
 * card URL, so a cached image whose `load` fired before that effect left the
 * art invisible for good. It is now derived from the URL that actually loaded,
 * and a previous load error (which hides the image inline) is cleared whenever
 * the card changes.
 */

function makeProfile(card: string): Profile {
  return {
    profile_name: "Alpha#EUW",
    description: "",
    valorant_puuid: "puuid-alpha",
    valorant_region: "eu",
    valorant_in_game_name: "Alpha#EUW",
    valorant_data: { player_card_bg: card } as Profile["valorant_data"],
    is_running: false,
  };
}

const CARD_A = "card://animated/Chamber_Mastery_Card_animated.apng";
const CARD_B = "https://media.valorant-api.com/playercards/new/largeart.png";

function renderCard(card: string) {
  const onLaunch = vi.fn();
  const onDelete = vi.fn();
  const utils = render(
    <ProfileCard profile={makeProfile(card)} running={false} launchState="idle" onLaunch={onLaunch} onDelete={onDelete} />
  );
  const art = () => utils.container.querySelector<HTMLImageElement>("img.lobby-art")!;
  return { ...utils, art, onLaunch, onDelete };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.classList.remove("app-inactive");
});

describe("ProfileCard playercard art", () => {
  it("shows the new card after the selection loads", () => {
    const { art, rerender } = renderCard(CARD_A);
    fireEvent.load(art());
    expect(art().className).not.toContain("is-charging");

    rerender(
      <ProfileCard profile={makeProfile(CARD_B)} running={false} launchState="idle" onLaunch={vi.fn()} onDelete={vi.fn()} />
    );
    expect(art().getAttribute("src")).toBe(CARD_B);
    expect(art().className).toContain("is-charging");

    fireEvent.load(art());
    expect(art().className).not.toContain("is-charging");
  });

  it("keeps the new card visible across unrelated profile updates", () => {
    const { art, rerender } = renderCard(CARD_A);
    fireEvent.load(art());

    rerender(
      <ProfileCard profile={makeProfile(CARD_B)} running={false} launchState="idle" onLaunch={vi.fn()} onDelete={vi.fn()} />
    );
    fireEvent.load(art());

    // e.g. rank/RR refresh: same card, new object
    const updated = makeProfile(CARD_B);
    updated.valorant_data = { ...updated.valorant_data, rr: 80 } as Profile["valorant_data"];
    rerender(<ProfileCard profile={updated} running={false} launchState="idle" onLaunch={vi.fn()} onDelete={vi.fn()} />);

    expect(art().getAttribute("src")).toBe(CARD_B);
    expect(art().className).not.toContain("is-charging");
  });

  it("swaps an APNG for a still while the window is inactive", () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { container } = render(
      <AppActiveProvider>
        <ProfileCard profile={makeProfile(CARD_A)} running={false} launchState="idle" onLaunch={vi.fn()} onDelete={vi.fn()} />
      </AppActiveProvider>
    );
    const art = container.querySelector<HTMLImageElement>("img.lobby-art")!;

    expect(art.getAttribute("src")).toMatch(/^data:image\/gif;base64,/);

    hasFocus.mockReturnValue(true);
    fireEvent.focus(window);
    expect(art.getAttribute("src")).toBe(CARD_A);
  });

  it("un-hides the art when a failed card is replaced by a good one", () => {
    const { art, rerender } = renderCard(CARD_A);
    fireEvent.error(art());
    expect(art().style.display).toBe("none");

    rerender(
      <ProfileCard profile={makeProfile(CARD_B)} running={false} launchState="idle" onLaunch={vi.fn()} onDelete={vi.fn()} />
    );
    expect(art().style.display).toBe("");

    fireEvent.load(art());
    expect(art().className).not.toContain("is-charging");
  });
});
