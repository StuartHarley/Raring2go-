import Link from "next/link";
import type { Route } from "next";

export type BreadcrumbItem = {
  label: string;
  href?: Route;
};

export type RelatedRecord = {
  label: string;
  title: string;
  description: string;
  href?: Route | `#${string}`;
  status?: string;
};

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  approved: "info",
  active: "success",
  sent: "success",
  completed: "success",
  scheduled: "info",
  sending: "warning",
  testing: "warning",
  paused: "warning",
  queued: "warning",
  processing: "warning",
  failed: "danger",
  rejected: "danger",
  retired: "neutral"
};

/** A colour-coded status pill, using the design system's own status tokens instead of plain text. */
export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return <span className={`status-badge status-badge--${tone}`}>{status}</span>;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="app-breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`}>
          {item.href ? <Link href={item.href}>{item.label}</Link> : <strong>{item.label}</strong>}
        </span>
      ))}
    </nav>
  );
}

export function RelatedRecords({
  title = "Workflow context",
  records
}: {
  title?: string;
  records: RelatedRecord[];
}) {
  if (records.length === 0) {
    return null;
  }

  return (
    <section className="app-panel franchise-panel workflow-context">
      <p className="eyebrow">Related records</p>
      <h2>{title}</h2>
      <div className="workflow-links">
        {records.map((record) => {
          const content = (
            <>
              <span>{record.label}</span>
              <strong>{record.title}</strong>
              <small>{record.description}</small>
              {record.status ? <em>{record.status}</em> : null}
            </>
          );

          if (record.href?.startsWith("#")) {
            return (
              <a key={`${record.label}-${record.title}`} href={record.href}>
                {content}
              </a>
            );
          }

          return record.href ? (
            <Link key={`${record.label}-${record.title}`} href={record.href}>
              {content}
            </Link>
          ) : (
            <div key={`${record.label}-${record.title}`}>{content}</div>
          );
        })}
      </div>
    </section>
  );
}
