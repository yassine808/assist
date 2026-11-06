import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import ProfileCard from "./ProfileCard";
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
    <ProfileCard
      profile={makeProfile(card)}
      running={false}
      launchState="idle"
      onLaunch={onLaunch}
      onDelete={onDelete}
    />,
  );
  const art = () => utils.container.querySelector<HTMLImageElement>("img.lobby-art")!;
  return { ...utils, art, onLaunch, onDelete };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.classList.remove("app-inactive");
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

describe("ProfileCard playercard art", () => {
  it("shows the new card after the selection loads", () => {
    const { art, rerender } = renderCard(CARD_A);
    fireEvent.load(art());
    expect(art().className).not.toContain("is-charging");

    rerender(
      <ProfileCard
        profile={makeProfile(CARD_B)}
        running={false}
        launchState="idle"
        onLaunch={vi.fn()}
        onDelete={vi.fn()}
      />,
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
      <ProfileCard
        profile={makeProfile(CARD_B)}
        running={false}
        launchState="idle"
        onLaunch={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.load(art());

    // e.g. rank/RR refresh: same card, new object
    const updated = makeProfile(CARD_B);
    updated.valorant_data = { ...updated.valorant_data, rr: 80 } as Profile["valorant_data"];
    rerender(
      <ProfileCard profile={updated} running={false} launchState="idle" onLaunch={vi.fn()} onDelete={vi.fn()} />,
    );

    expect(art().getAttribute("src")).toBe(CARD_B);
    expect(art().className).not.toContain("is-charging");
  });

  it("keeps the playercard art visible when the app is not focused", () => {
    // Pausing animations must never swap or blank the card art: only CSS
    // timelines and the beams canvas stop while the window is covered.
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    const { art } = renderCard(CARD_A);

    expect(art().getAttribute("src")).toBe(CARD_A);

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    fireEvent.blur(window);

    expect(art().getAttribute("src")).toBe(CARD_A);
  });

  it("un-hides the art when a failed card is replaced by a good one", () => {
    const { art, rerender } = renderCard(CARD_A);
    fireEvent.error(art());
    expect(art().style.display).toBe("none");

    rerender(
      <ProfileCard
        profile={makeProfile(CARD_B)}
        running={false}
        launchState="idle"
        onLaunch={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(art().style.display).toBe("");

    fireEvent.load(art());
    expect(art().className).not.toContain("is-charging");
  });
});

describe("ProfileCard sign-out button", () => {
  it("only offers sign-out while the profile is running", () => {
    const onSignOut = vi.fn();
    const { container, rerender } = render(
      <ProfileCard
        profile={makeProfile(CARD_A)}
        running={false}
        launchState="idle"
        onLaunch={vi.fn()}
        onDelete={vi.fn()}
        onSignOut={onSignOut}
      />,
    );
    expect(container.querySelector(".lobby-signout")).toBeNull();

    rerender(
      <ProfileCard
        profile={makeProfile(CARD_A)}
        running
        launchState="idle"
        onLaunch={vi.fn()}
        onDelete={vi.fn()}
        onSignOut={onSignOut}
      />,
    );

    const button = container.querySelector<HTMLButtonElement>(".lobby-signout");
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toContain("sign out");

    fireEvent.click(button!);
    expect(onSignOut).toHaveBeenCalledWith("Alpha#EUW");
  });

  it("keeps the RUNNING button next to it", () => {
    const { container } = render(
      <ProfileCard
        profile={makeProfile(CARD_A)}
        running
        launchState="idle"
        onLaunch={vi.fn()}
        onDelete={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    const row = container.querySelector(".lobby-ctl");
    expect(row?.querySelector(".lobby-signout")).not.toBeNull();
    expect(row?.querySelector(".lobby-start")).not.toBeNull();
    expect(row?.querySelector(".lobby-start")?.textContent).toBe("RUNNING");
    // The sign-out button must come after START, not before it.
    expect(row?.lastElementChild?.classList.contains("lobby-signout")).toBe(true);
  });
});

describe("ProfileCard launch button", () => {
  // Regression for the LAUNCHED state: it used to render a square check icon
  // after the label while the fixed-width label overflowed the button, so the
  // text was cut on both edges. LAUNCHED is now label-only and centred.
  it("shows the spinner icon while launching", () => {
    const { container } = render(
      <ProfileCard
        profile={makeProfile(CARD_A)}
        running={false}
        launchState="launching"
        onLaunch={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const button = container.querySelector(".lobby-start");
    expect(button?.textContent).toBe("LAUNCHING");
    expect(button?.querySelector("svg.start-icon")).not.toBeNull();
  });

  it("renders LAUNCHED as a bare, centred label", () => {
    const { container } = render(
      <ProfileCard
        profile={makeProfile(CARD_A)}
        running={false}
        launchState="launched"
        onLaunch={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const button = container.querySelector(".lobby-start");
    expect(button?.classList.contains("is-launched")).toBe(true);
    expect(button?.textContent).toBe("LAUNCHED");
    expect(button?.querySelector("svg")).toBeNull();
    expect(button?.querySelector(".lobby-start-label")).not.toBeNull();
  });

  it("hides sign-out while a launch is in flight", () => {
    // The sign-out button used to stay visible and take ~46px from the row,
    // which is what squeezed LAUNCHING/LAUNCHED into an overflow.
    for (const launchState of ["launching", "launched"] as const) {
      const { container, unmount } = render(
        <ProfileCard
          profile={makeProfile(CARD_A)}
          running
          launchState={launchState}
          onLaunch={vi.fn()}
          onDelete={vi.fn()}
          onSignOut={vi.fn()}
        />,
      );
      expect(container.querySelector(".lobby-signout")).toBeNull();
      unmount();
    }
  });
});
