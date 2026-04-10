"use client";

import { create } from "zustand";

type AppState = {
  commandPaletteOpen: boolean;
  selectedTrendId: string | null;
  setCommandPaletteOpen: (open: boolean) => void;
  setSelectedTrendId: (selectedTrendId: string | null) => void;
  clearSelectedTrendId: () => void;
};

export const useAppStore = create<AppState>((set) => ({
  commandPaletteOpen: false,
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  selectedTrendId: null,
  setSelectedTrendId: (selectedTrendId) => set({ selectedTrendId }),
  clearSelectedTrendId: () => set({ selectedTrendId: null }),
}));
