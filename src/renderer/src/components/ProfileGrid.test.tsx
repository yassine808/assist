import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProfileGrid from "./ProfileGrid";
import type { Profile } from "../types/profile";

/**
 * The START button used to live on a `useProfileLaunch()` instance owned by
 * each card, while `HomeView` tracked launch state on a *different* instance.
 * The backend call still fired, but the card never saw the progress events, so
 * the button never disabled and never showed "LAUNCHING". These tests pin the
 * single-source-of-truth wiring: the grid receives one `onLaunch` and the card
 * reflects the `launchState` it is given.
 */

function makeProfile(name: string): Profile {
  return {
    profile_name: name,
    description: "",
    valorant_puuid: "",
    valorant_region: "",
    valorant_in_game_name: name,
    valorant_data: {} as Profile["valorant_data"],
    is_running: false,
  };
}

describe("ProfileGrid launch wiring", () => {
  it("calls the single onLaunch with the clicked profile name", () => {
    const onLaunch = vi.fn();
    render(
      <ProfileGrid
        profiles={[makeProfile("Alpha#EUW")]}
        loading={false}
        onLaunch={onLaunch}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith("Alpha#EUW");
  });

  it("disables the button while that profile is launching", () => {
    const onLaunch = vi.fn();
    render(
      <ProfileGrid
        profiles={[makeProfile("Alpha#EUW")]}
        loading={false}
        launchState="launching"
        launchingProfile="Alpha#EUW"
        onLaunch={onLaunch}
        onDelete={vi.fn()}
      />
    );

    const button = screen.getByRole("button", { name: /launching/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(button);
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("leaves other profiles clickable while one is launching", () => {
    const onLaunch = vi.fn();
    render(
      <ProfileGrid
        profiles={[makeProfile("Alpha#EUW"), makeProfile("Beta#EUW")]}
        loading={false}
        launchState="launching"
        launchingProfile="Alpha#EUW"
        onLaunch={onLaunch}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));

    expect(onLaunch).toHaveBeenCalledWith("Beta#EUW");
  });
});
