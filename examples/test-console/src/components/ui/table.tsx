// Trimmed from rawtree-platform/frontend/src/components/ui/table.tsx.
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative min-h-0 w-full flex-1 overflow-auto border-t border-border">
      <table data-slot="table" className={cn("w-full border-separate border-spacing-0 caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("sticky top-0 z-10 bg-muted", className)} {...props} />;
}

function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&_tr:last-child>td]:border-b-0", className)} {...props} />;
}

function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr data-slot="table-row" className={cn("transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted", className)} {...props} />;
}

function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn("h-10 border-b border-border px-3 py-2 text-left align-middle text-sm font-medium whitespace-nowrap text-foreground", className)}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("border-b border-border px-3 py-2 align-middle text-sm whitespace-nowrap text-foreground", className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
