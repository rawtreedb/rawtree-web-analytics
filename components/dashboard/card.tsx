import type { ComponentProps, ReactNode } from "react";
import { InfoTip } from "../ui/info-tip.tsx";
import { cardClass, cn } from "../ui/styles.ts";

/** Dashboard card frame: title with optional info tip, description, header action, body, footer. */
export function DashboardCard({
  title,
  description,
  info,
  action,
  footer,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  info?: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(cardClass, "flex h-full min-h-0 flex-col overflow-hidden text-sm", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5 px-5 pt-4.5">
        <div className="min-w-0">
          <h3 className="mb-0.5 flex items-center gap-1.5 text-base font-semibold">
            {title}
            {info ? <InfoTip>{info}</InfoTip> : null}
          </h3>
          {description ? <p className="text-xs leading-normal text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="flex flex-none items-center gap-2">{action}</div> : null}
      </div>
      <div className="min-h-0 min-w-0 flex-1 px-5 pt-4 pb-5">{children}</div>
      {footer ? <div className="flex items-center justify-between gap-4 border-t py-2 pr-3 pl-5 text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

/** Dashed placeholder shown inside a card or section when it has nothing to show. */
export function CardEmpty({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("m-0 grid min-h-28 place-items-center rounded-lg border border-dashed p-4 text-center text-xs leading-normal text-muted-foreground", className)}
      data-slot="card-empty"
      {...props}
    />
  );
}

/** Error banner for failed queries. */
export function ErrorCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-badge-error-fg/20 bg-badge-error-bg px-5 py-4 text-sm">
      <p className="font-semibold">Queries failed</p>
      <p className="mt-1 text-muted-foreground">{children}</p>
    </div>
  );
}
