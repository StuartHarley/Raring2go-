import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { Badge, Card, KpiCard } from "@raring2go/ui";
import { formatLabel } from "./format";

/**
 * The page anatomy every operator screen shares, built on the design-system primitives in
 * `@raring2go/ui` so pages never restyle cards, badges, buttons or KPI tiles themselves.
 */

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "spring" | "summer" | "autumn" | "winter";

type Season = "spring" | "summer" | "autumn" | "winter";

export function PageHeader({
  eyebrow,
  title,
  intro,
  actions,
  children
}: {
  eyebrow?: string;
  title: ReactNode;
  intro?: ReactNode;
  /** Primary and secondary actions, right-aligned on wide screens. One primary button per page. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {intro ? <p className="page-header__intro">{intro}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
      {children}
    </header>
  );
}

export function Panel({
  eyebrow,
  title,
  intro,
  actions,
  accent,
  className,
  id,
  children
}: {
  eyebrow?: string;
  title?: ReactNode;
  intro?: ReactNode;
  actions?: ReactNode;
  accent?: "brand" | Season;
  className?: string;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <Card accent={accent} className={["app-panel", className].filter(Boolean).join(" ")} id={id}>
      {eyebrow || title || intro || actions ? (
        <div className="app-panel__header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? <h2>{title}</h2> : null}
            {intro ? <p className="app-panel__intro">{intro}</p> : null}
          </div>
          {actions ? <div className="app-panel__actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

export type Metric = {
  label: string;
  value: string | number;
  detail?: string;
  /** Colour the tile by meaning (danger for blocked work, warning for watch items). Neutral by default. */
  tone?: Tone;
};

export function Metrics({ items }: { items: Metric[] }) {
  return (
    <div className="metric-grid">
      {items.map((item) => (
        <KpiCard key={item.label} label={item.label} value={String(item.value)} detail={item.detail} tone={item.tone ?? "neutral"} />
      ))}
    </div>
  );
}

export function LinkButton({
  href,
  variant = "primary",
  children,
  className
}: {
  href: Route;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={["r2-button", `r2-button--${variant}`, className].filter(Boolean).join(" ")}>
      {children}
    </Link>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  active: "success",
  approved: "info",
  blocked: "danger",
  cancelled: "neutral",
  clear: "success",
  completed: "success",
  complete: "success",
  draft: "neutral",
  expired: "danger",
  failed: "danger",
  generated: "success",
  healthy: "success",
  live: "success",
  not_connected: "neutral",
  not_created: "neutral",
  on_track: "success",
  overdue: "danger",
  paused: "warning",
  pending: "warning",
  pending_review: "warning",
  planning: "info",
  processing: "warning",
  published: "success",
  queued: "warning",
  ready: "success",
  rejected: "danger",
  retained: "success",
  retired: "neutral",
  scheduled: "info",
  sending: "warning",
  sent: "success",
  signed: "success",
  testing: "warning",
  trading: "success",
  watch: "warning"
};

export function toneForStatus(status: string | null | undefined): Tone {
  if (!status) return "neutral";
  return STATUS_TONE[status.toLowerCase()] ?? "neutral";
}

/** A colour-coded status pill. The machine value becomes words; the colour comes from its meaning. */
export function StatusBadge({ status, tone }: { status: string | null | undefined; tone?: Tone }) {
  return <Badge tone={tone ?? toneForStatus(status)}>{formatLabel(status)}</Badge>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state" role="status">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

/** A stack of linked records: title, a status pill and up to a few lines of plain-English detail. */
export function RecordList({ children }: { children: ReactNode }) {
  return <div className="record-list">{children}</div>;
}

export function RecordLink({
  href,
  title,
  status,
  tone,
  lines
}: {
  href: Route;
  title: ReactNode;
  status?: string | null;
  tone?: Tone;
  lines: ReadonlyArray<ReactNode>;
}) {
  return (
    <Link href={href} className="record-link">
      <span className="record-link__head">
        <strong>{title}</strong>
        {status ? <StatusBadge status={status} tone={tone} /> : null}
      </span>
      {lines.filter(Boolean).map((line, index) => (
        <span key={index} className="record-link__line">
          {line}
        </span>
      ))}
    </Link>
  );
}

/** The result of an action just taken (from a `?result=` code): success or error, in one line. */
export function Notice({ tone, children }: { tone: "success" | "error" | "info" | "warning"; children: ReactNode }) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`notice notice--${tone}`}>
      {children}
    </p>
  );
}

/** Pill links that filter a list; the current one is marked for assistive tech and styled. */
export function FilterTabs({ items, label = "Filter" }: { items: Array<{ label: string; href: Route; current?: boolean }>; label?: string }) {
  return (
    <nav className="filter-tabs" aria-label={label}>
      {items.map((item) => (
        <Link key={item.label} href={item.href} aria-current={item.current ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** Key facts about a record as a definition list of small tiles. */
export function FactList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="fact-list">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A row of buttons or links under a form or a heading. */
export function Actions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["action-row", className].filter(Boolean).join(" ")}>{children}</div>;
}

/** A semantic data table that scrolls sideways on narrow screens. Columns are rendered by the caller. */
export function Table({ caption, children }: { caption?: string; children: ReactNode }) {
  return (
    <div className="table-scroll">
      <table className="r2-table">
        {caption ? <caption>{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

/** The non-link twin of RecordLink: a record row that holds its own forms or buttons. */
export function RecordCard({
  title,
  status,
  tone,
  lines = [],
  children
}: {
  title: ReactNode;
  status?: string | null;
  tone?: Tone;
  lines?: ReadonlyArray<ReactNode>;
  children?: ReactNode;
}) {
  return (
    <div className="record-card">
      <span className="record-card__head">
        <strong>{title}</strong>
        {status ? <StatusBadge status={status} tone={tone} /> : null}
      </span>
      {lines.filter(Boolean).map((line, index) => (
        <span key={index} className="record-card__line">
          {line}
        </span>
      ))}
      {children}
    </div>
  );
}
