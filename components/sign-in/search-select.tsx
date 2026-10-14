"use client";

// A select whose popup has a search input to filter its fixed options.
import { Combobox } from "@base-ui/react/combobox";
import { IconCheck, IconSearch, IconSelector } from "@tabler/icons-react";
import { cn, inputClass } from "../ui/styles.ts";

export function SearchSelect({
  label,
  items,
  value,
  onValueChange,
  placeholder,
}: {
  label: string;
  items: string[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <Combobox.Root
      disabled={items.length === 0}
      items={items}
      onValueChange={(next: string | null) => {
        if (next) onValueChange(next);
      }}
      value={value || null}
    >
      {/* base-ui 1.2 has no Combobox.Label; a wrapping label names the trigger button. */}
      <label className="grid gap-1.5 text-sm font-medium">
        {label}
        <Combobox.Trigger
          className={cn(inputClass, "flex h-10 w-full items-center justify-between gap-2 text-left font-normal disabled:cursor-not-allowed disabled:opacity-50 data-popup-open:border-ring")}
        >
          <span className="truncate">
            <Combobox.Value placeholder={<span className="text-muted-foreground">{placeholder}</span>} />
          </span>
          <Combobox.Icon className="shrink-0 text-muted-foreground">
            <IconSelector className="size-4" />
          </Combobox.Icon>
        </Combobox.Trigger>
      </label>
      <Combobox.Portal>
        <Combobox.Positioner align="start" className="z-50 outline-none" sideOffset={4}>
          <Combobox.Popup aria-label={label} className="w-(--anchor-width) overflow-hidden rounded-lg border bg-card shadow-soft outline-none">
            <div className="flex items-center gap-2 border-b px-3">
              <IconSearch aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <Combobox.Input
                className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                placeholder={`Search ${label.toLowerCase()}…`}
              />
            </div>
            <Combobox.Empty className="px-3 py-4 text-sm text-muted-foreground empty:hidden">No {label.toLowerCase()} found.</Combobox.Empty>
            <Combobox.List className="max-h-64 overflow-y-auto p-1 empty:hidden">
              {(item: string) => (
                <Combobox.Item
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  key={item}
                  value={item}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <Combobox.ItemIndicator>
                      <IconCheck className="size-4 text-primary" />
                    </Combobox.ItemIndicator>
                  </span>
                  <span className="truncate">{item}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
