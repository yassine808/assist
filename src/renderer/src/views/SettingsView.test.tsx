import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Wiring coverage for the profile-export download in SettingsView.
 *
 * `utils/base64.test.ts` proves the decoder in isolation; it cannot catch the
 * component handing the wrong value to it. The original bug was
 * `new Blob([result.data])` over the base64 *text*, which produced a
 * 0-byte-or-garbage backup file that only failed later, on import. These
 * tests read the bytes back out of the blob the component actually creates.
 */

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));

vi.mock("../hooks/useIPC", () => ({ useIPC: () => ({ call: callMock }) }));

import SettingsView from "./SettingsView";

/** Decodes to the six bytes 00 01 02 fd fe ff — deliberately not valid UTF-8. */
const PAYLOAD_B64 = "AAEC/f7/";
const PAYLOAD_BYTES = new Uint8Array([0x00, 0x01, 0x02, 0xfd, 0xfe, 0xff]);

const blobs: Blob[] = [];
const revoked: string[] = [];
const clicks: { href: string; download: string }[] = [];

const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;

function renderExport() {
  render(<SettingsView />);
  return screen.getByPlaceholderText("Encryption passkey") as HTMLInputElement;
}

async function clickExport(passkey: string) {
  const input = renderExport();
  fireEvent.change(input, { target: { value: passkey } });
  fireEvent.click(screen.getByRole("button", { name: /export/i }));
}

describe("SettingsView profile export", () => {
  beforeEach(() => {
    blobs.length = 0;
    revoked.length = 0;
    clicks.length = 0;
    callMock.mockReset();
    callMock.mockImplementation(async (method: string) => {
      if (method === "get_config") return {};
      if (method === "get_profiles") return [];
      if (method === "export_profiles") return { data: PAYLOAD_B64 };
      return null;
    });
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return `blob:mock-${blobs.length}`;
    });
    URL.revokeObjectURL = vi.fn((u: string) => {
      revoked.push(u);
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        clicks.push({ href: this.href, download: this.download });
      }
    );
  });

  afterEach(() => {
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it("sends the passkey to export_profiles", async () => {
    await clickExport("hunter2");
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith("export_profiles", {
        passkey: "hunter2",
      })
    );
  });

  it("downloads the decoded bytes, not the base64 text", async () => {
    await clickExport("hunter2");
    await waitFor(() => expect(blobs).toHaveLength(1));
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(PAYLOAD_BYTES));
    expect(blobs[0]!.size).toBe(PAYLOAD_BYTES.length);
  });

  it("anchors the download to the blob and names it .rsprofile", async () => {
    await clickExport("hunter2");
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0]!.href).toBe("blob:mock-1");
    expect(clicks[0]!.download).toMatch(
      /^riotswitcher-profiles-\d{4}-\d{2}-\d{2}\.rsprofile$/
    );
  });

  it("revokes the object URL it created", async () => {
    await clickExport("hunter2");
    await waitFor(() => expect(revoked).toEqual(["blob:mock-1"]));
  });

  it("keeps Export disabled until a passkey is entered", async () => {
    renderExport();
    // Let the mount effects resolve so their state updates are act()-wrapped.
    await waitFor(() => expect(callMock).toHaveBeenCalledWith("get_config"));
    const button = screen.getByRole("button", {
      name: /export/i,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(callMock).not.toHaveBeenCalledWith(
      "export_profiles",
      expect.anything()
    );
    expect(blobs).toHaveLength(0);
  });

  it("downloads nothing when the backend call fails", async () => {
    callMock.mockImplementation(async (method: string) => {
      if (method === "get_config") return {};
      if (method === "get_profiles") return [];
      if (method === "export_profiles") throw new Error("bridge down");
      return null;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await clickExport("hunter2");
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith("export_profiles", {
        passkey: "hunter2",
      })
    );
    expect(clicks).toHaveLength(0);
    expect(blobs).toHaveLength(0);
  });

  it("downloads nothing when the backend returns no payload", async () => {
    callMock.mockImplementation(async (method: string) => {
      if (method === "get_config") return {};
      if (method === "get_profiles") return [];
      if (method === "export_profiles") return { data: "" };
      return null;
    });
    await clickExport("hunter2");
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith("export_profiles", {
        passkey: "hunter2",
      })
    );
    expect(clicks).toHaveLength(0);
  });
});

// Guards the fixture itself: if PAYLOAD_B64 and PAYLOAD_BYTES ever drift, every
// byte assertion above would still pass while testing the wrong pair.
describe("export test fixture", () => {
  it("decodes PAYLOAD_B64 to PAYLOAD_BYTES", () => {
    const decoded = Uint8Array.from(
      Buffer.from(PAYLOAD_B64, "base64")
    );
    expect(Array.from(decoded)).toEqual(Array.from(PAYLOAD_BYTES));
  });
});
