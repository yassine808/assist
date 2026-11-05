import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Export scope + passkey copy.
 *
 * The backup used to be all-or-nothing. "Select accounts" must send exactly the
 * ticked profile names to `export_profiles`, and "All profiles" must send no
 * `names` key at all so the backend keeps exporting everything. The copy button
 * has to put the passkey on the clipboard before it is cleared.
 */

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));

vi.mock("../hooks/useIPC", () => ({ useIPC: () => ({ call: callMock }) }));

import ImportExportModal from "./ImportExportModal";
import type { Profile } from "../types/profile";

function makeProfile(name: string): Profile {
  return {
    profile_name: name,
    description: "",
    valorant_puuid: `puuid-${name}`,
    valorant_region: "eu",
    valorant_in_game_name: name,
    valorant_data: {} as Profile["valorant_data"],
    is_running: false,
  };
}

const PROFILES = [makeProfile("Alpha#EUW"), makeProfile("Beta#EUW")];
const PAYLOAD_B64 = "AAEC/f7/";

const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;

function renderModal() {
  render(<ImportExportModal open onClose={vi.fn()} profiles={PROFILES} />);
  return screen.getByPlaceholderText("Encryption passkey") as HTMLInputElement;
}

describe("ImportExportModal export", () => {
  beforeEach(() => {
    callMock.mockReset();
    callMock.mockImplementation(async (method: string) => {
      if (method === "export_profiles") return { data: PAYLOAD_B64 };
      return null;
    });
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it("exports everything without a names filter by default", async () => {
    const input = renderModal();
    fireEvent.change(input, { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: /export backup/i }));

    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith("export_profiles", { passkey: "hunter2" })
    );
  });

  it("sends only the selected profile names", async () => {
    const input = renderModal();
    fireEvent.click(screen.getByRole("radio", { name: /select accounts/i }));
    const [first] = screen.getAllByRole("checkbox");
    fireEvent.click(first!);
    fireEvent.change(input, { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: /export backup/i }));

    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith("export_profiles", {
        passkey: "hunter2",
        names: ["Alpha#EUW"],
      })
    );
  });

  it("select all ticks every profile", () => {
    renderModal();
    fireEvent.click(screen.getByRole("radio", { name: /select accounts/i }));
    fireEvent.click(screen.getByRole("button", { name: /select all/i }));
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it("copies the passkey to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    const input = renderModal();
    fireEvent.change(input, { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: /copy passkey/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("hunter2"));
  });
});
