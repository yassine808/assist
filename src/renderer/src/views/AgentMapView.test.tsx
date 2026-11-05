import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));

vi.mock("../hooks/useIPC", () => ({
  useIPC: () => ({ call: callMock, onEvent: () => () => undefined }),
}));

import AgentMapView from "./AgentMapView";

const PROFILE = {
  profile_name: "Main",
  description: "",
  valorant_puuid: "puuid-main",
  valorant_region: "eu",
  valorant_in_game_name: "Main#EU",
  is_running: false,
  valorant_data: {
    map_stats: [
      {
        map: "Ascent",
        games: 2,
        wins: 2,
        winrate: 100,
        avg_score: 250,
        agents: [
          { agent: "Jett", games: 2, wins: 2, winrate: 100, avg_score: 260, display_icon: "", role: "Duelist" },
        ],
      },
      {
        map: "Haven",
        games: 3,
        wins: 1,
        winrate: 33,
        avg_score: 190,
        agents: [
          { agent: "Sage", games: 3, wins: 1, winrate: 33, avg_score: 190, display_icon: "", role: "Sentinel" },
        ],
      },
    ],
  },
};

beforeEach(() => {
  callMock.mockReset();
  callMock.mockImplementation(async (method: string) => {
    if (method === "get_config") return { PerMapStats: true };
    if (method === "get_valorant_maps") return [];
    if (method === "get_profiles") return [PROFILE];
    return null;
  });
});

async function renderView() {
  render(<AgentMapView />);
  await waitFor(() => expect(screen.getByText("Overall winrate")).toBeTruthy());
}

describe("Agent Map summary and filters", () => {
  it("summarises maps, games, overall winrate and the best map", async () => {
    await renderView();

    expect(screen.getByText("Maps played").parentElement?.textContent).toContain("2");
    expect(screen.getByText("Total games").parentElement?.textContent).toContain("5");
    expect(screen.getByText("Overall winrate").parentElement?.textContent).toContain("60%");
    expect(screen.getByText("Best map").parentElement?.textContent).toContain("Ascent");
  });

  it("filters maps down to the agents that match the search", async () => {
    await renderView();
    fireEvent.change(screen.getByLabelText("Filter maps and agents"), {
      target: { value: "sage" },
    });

    expect(screen.getByRole("heading", { name: "Haven" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Ascent" })).toBeNull();
  });

  it("sorts maps by name on request", async () => {
    await renderView();
    // Default is "most played": Haven (3 games) comes before Ascent (2).
    const headings = () =>
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings()).toEqual(["Haven", "Ascent"]);

    fireEvent.change(screen.getByLabelText("Sort maps"), { target: { value: "name" } });
    expect(headings()).toEqual(["Ascent", "Haven"]);
  });
});
