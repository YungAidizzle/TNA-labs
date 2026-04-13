"use client";

import { Command } from "cmdk";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { GROUPED_NAV_ITEMS } from "@/lib/constants/navigation";
import { useAppStore } from "@/store/app-store";

export function CommandPalette() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const open = useAppStore((state) => state.commandPaletteOpen);
  const setOpen = useAppStore((state) => state.setCommandPaletteOpen);

  const close = () => {
    setQuery("");
    setOpen(false);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setQuery("");
        }
        setOpen(nextOpen);
      }}
      label="Global command palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 p-6 pt-[12vh] backdrop-blur-md"
    >
      <div className="surface-panel w-full max-w-2xl border border-border bg-panel-strong">
        <div className="border-b border-border px-4 py-3">
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Jump to a page"
            className="w-full bg-transparent text-[18px] font-medium text-foreground outline-none placeholder:text-soft"
          />
        </div>
        <Command.List className="max-h-[58vh] overflow-y-auto p-3">
          <Command.Empty className="px-3 py-10 text-center text-sm text-muted">
            No matching routes.
          </Command.Empty>

          {GROUPED_NAV_ITEMS.map((group) => (
            <Command.Group key={group.key} heading={group.label} className="mb-3 last:mb-0">
              {group.items.map((item) => {
                return (
                  <Command.Item
                    key={item.href}
                    value={`${group.label} ${item.label} ${item.description}`}
                    onSelect={() => {
                      close();
                      router.push(item.href);
                    }}
                    className="flex items-center justify-between px-3 py-3.5 text-[14px] text-muted outline-none data-[selected=true]:bg-white/6 data-[selected=true]:text-foreground"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 truncate">
                        <span className="truncate">{item.label}</span>
                      </span>
                      <span className="mt-1 block truncate text-[12px] text-soft">
                        {item.description}
                      </span>
                    </span>
                    {item.shortcut ? (
                      <span className="font-mono text-[12px] text-soft">Alt+{item.shortcut}</span>
                    ) : null}
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
