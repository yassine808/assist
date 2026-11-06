import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Profile } from "../types/profile";

/**
 * VALORANT block flow: the backend refuses to touch the game and answers with
 * `code: "valorant_running"`. The UI must offer the "Quit VALORANT?" dialog and
 * retry the pending action once the game is gone, instead of showing the old
 * "Close VALORANT before switching accounts" toast.
 */

const { callMock, onEventMock } = vi.hoisted(() => ({
  callMock: vi.fn(),
  onEventMock: vi.fn(),
}));

vi.mock("../hooks/useIPC", () => ({
  useIPC: () => ({ call: callMock, onEvent: onEventMock }),
}));

import HomeView from "./HomeView";

function makeProfile(running: boolean): Profile {
  return {
    profile_name: "Alpha#EUW",
    description: "",
    valorant_puuid: "puuid-alpha",
    valorant_region: "eu",
    valorant_in_game_name: "Alpha#EUW",
    valorant_data: { tier: 12, rr: 40, wins: 3, losses: 2 } as Profile["valorant_data"],
    is_running: running,
  };
}

describe("HomeView VALORANT confirmation", () => {
  beforeEach(() => {
    callMock.mockReset();
    onEventMock.mockReset();
    onEventMock.mockReturnValue(() => undefined);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getAnimatedCards: async () => [],
    };
  });

  it("offers to quit VALORANT when a launch is blocked, then retries", async () => {
    let launches = 0;
    callMock.mockImplementation(async (method: string) => {
      if (method === "get_profiles") return [makeProfile(false)];
      if (method === "launch_profile") {
        launches += 1;
        return launches === 1
          ? { ok: false, step: "kill", code: "valorant_running", error: "Close VALORANT before switching accounts" }
          : { ok: true, pid: 4242 };
      }
      if (method === "quit_valorant") return { ok: true };
      return null;
    });

    render(<HomeView />);
    fireEvent.click(await screen.findByRole("button", { name: /start/i }));

    expect(await screen.findByText("Quit VALORANT?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^quit valorant$/i }));

    await waitFor(() => expect(launches).toBe(2));
  });

  it("keeps the profile and retries the sign-out after quitting the game", async () => {
    const calls: string[] = [];
    let signOuts = 0;
    callMock.mockImplementation(async (method: string) => {
      calls.push(method);
      if (method === "get_profiles") return [makeProfile(true)];
      if (method === "sign_out_profile") {
        signOuts += 1;
        return signOuts === 1
          ? { ok: false, step: "kill", code: "valorant_running", error: "Close VALORANT before switching accounts" }
          : { ok: true };
      }
      if (method === "quit_valorant") return { ok: true };
      return null;
    });

    render(<HomeView />);
    fireEvent.click(await screen.findByTitle("Exit Riot Client and sign out"));

    expect(calls).toContain("sign_out_profile");
    expect(await screen.findByText("Quit VALORANT?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^quit valorant$/i }));

    await waitFor(() => expect(signOuts).toBe(2));
    expect(calls).toContain("quit_valorant");
  });

  it("does not ask to quit the game when nothing is blocked", async () => {
    callMock.mockImplementation(async (method: string) => {
      if (method === "get_profiles") return [makeProfile(true)];
      if (method === "sign_out_profile") return { ok: true };
      return null;
    });

    render(<HomeView />);
    fireEvent.click(await screen.findByTitle("Exit Riot Client and sign out"));

    await waitFor(() => expect(callMock).toHaveBeenCalledWith("sign_out_profile", { name: "Alpha#EUW" }));
    expect(screen.queryByText("Quit VALORANT?")).toBeNull();
  });
});
