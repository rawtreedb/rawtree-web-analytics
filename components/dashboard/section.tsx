import type { ReactNode } from "react";

/** Titled dashboard section; its `id` is the anchor used by the sidebar. */
export function DashboardSection({
  id,
  title,
  description,
  badges,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  badges?: ReactNode;
  children: ReactNode;
}) {
  return (
    // scroll-mt clears the sticky page toolbar, including when its controls wrap.
    <section aria-labelledby={`${id}-title`} className="grid scroll-mt-36 gap-4" id={id}>
      <header>
        <div className="flex items-center gap-2">
          <h2 className="m-0 text-lg font-semibold tracking-tight" id={`${id}-title`}>
            {title}
          </h2>
          {badges}
        </div>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
