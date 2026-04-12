import { useAppStore } from "@/store/app-store";

describe("app store", () => {
  beforeEach(() => {
    useAppStore.setState(
      {
        commandPaletteOpen: false,
        selectedTrendId: null,
      },
      false,
    );
  });

  it("opens and closes the command palette", () => {
    useAppStore.getState().setCommandPaletteOpen(true);
    expect(useAppStore.getState().commandPaletteOpen).toBe(true);

    useAppStore.getState().setCommandPaletteOpen(false);
    expect(useAppStore.getState().commandPaletteOpen).toBe(false);
  });

  it("stores and clears the selected trend id independently of the command palette", () => {
    useAppStore.getState().setSelectedTrendId("trend-42");
    expect(useAppStore.getState().selectedTrendId).toBe("trend-42");

    useAppStore.getState().clearSelectedTrendId();
    expect(useAppStore.getState().selectedTrendId).toBeNull();
  });
});
