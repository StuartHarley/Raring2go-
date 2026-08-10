import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "quiet" | "danger";
type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "spring" | "summer" | "autumn" | "winter";

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={cx("r2-button", `r2-button--${variant}`, className)} {...props} />;
}

export function IconButton({
  label,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={cx("r2-icon-button", className)} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cx("r2-badge", `r2-badge--${tone}`, className)} {...props} />;
}

export function Card({
  accent,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { accent?: "brand" | "spring" | "summer" | "autumn" | "winter" }) {
  return <div className={cx("r2-card", accent && `r2-card--${accent}`, className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="r2-field">
      <span className="r2-field__label">{label}</span>
      {children}
      {hint ? <span className="r2-field__hint">{hint}</span> : null}
      {error ? <span className="r2-field__error">{error}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="r2-input" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="r2-input" {...props} />;
}

export function Tabs({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("r2-tabs", className)} role="tablist" {...props}>{children}</div>;
}

export function Tab({
  selected,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button className={cx("r2-tab", selected && "r2-tab--selected", className)} role="tab" aria-selected={selected} {...props} />
  );
}

export function KpiCard({
  label,
  value,
  detail,
  tone = "neutral"
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: Tone;
}) {
  return (
    <Card className="r2-kpi">
      <Badge tone={tone}>{label}</Badge>
      <strong>{value}</strong>
      {detail ? <span>{detail}</span> : null}
    </Card>
  );
}

export function StatePanel({
  title,
  children,
  tone = "neutral"
}: {
  title: string;
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <Card className="r2-state">
      <Badge tone={tone}>{title}</Badge>
      <p>{children}</p>
    </Card>
  );
}

export function ContentCard({
  kind,
  title,
  meta,
  season
}: {
  kind: "Article" | "Event" | "Offer" | "Competition";
  title: string;
  meta: string;
  season?: "spring" | "summer" | "autumn" | "winter";
}) {
  return (
    <Card accent={season} className="r2-content-card">
      <div className="r2-content-card__media" aria-hidden="true" />
      <Badge tone={season ?? "neutral"}>{kind}</Badge>
      <h3>{title}</h3>
      <p>{meta}</p>
    </Card>
  );
}

export function MagazinePageThumb({
  page,
  title,
  status,
  season = "autumn",
  locked
}: {
  page: number;
  title: string;
  status: string;
  season?: "spring" | "summer" | "autumn" | "winter";
  locked?: boolean;
}) {
  return (
    <Card accent={season} className="r2-page-thumb">
      <div className="r2-page-thumb__sheet">
        <span>{page}</span>
        <div className="r2-zone r2-zone--locked">Master</div>
        <div className="r2-zone r2-zone--editable">Local editable zone</div>
      </div>
      <strong>{title}</strong>
      <div className="r2-page-thumb__meta">
        <Badge tone={locked ? "info" : season}>{locked ? "Locked" : status}</Badge>
        <span>Print + digital</span>
      </div>
    </Card>
  );
}

export function Alert({
  tone = "info",
  title,
  children
}: {
  tone?: Exclude<Tone, "spring" | "summer" | "autumn" | "winter" | "neutral">;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("r2-alert", `r2-alert--${tone}`)} role="status">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
