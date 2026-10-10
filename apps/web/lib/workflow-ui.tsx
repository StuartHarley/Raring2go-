import Link from "next/link";
import type { Route } from "next";
import { Panel, StatusBadge } from "./page-ui";

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

export { StatusBadge };

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
    <Panel eyebrow="Related records" title={title} accent="brand" className="workflow-context">
      <div className="workflow-links">
        {records.map((record) => {
          const content = (
            <>
              <span>{record.label}</span>
              <strong>{record.title}</strong>
              <small>{record.description}</small>
              {record.status ? <StatusBadge status={record.status} /> : null}
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
    </Panel>
  );
}
