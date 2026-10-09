import type { ReactNode } from "react";

/**
 * The shared body of every "you can't go further" screen: access denied, context unavailable,
 * page missing. Plain words first, the technical reason last and small, and always a way on.
 */
export function OutcomePanel({
  eyebrow,
  title,
  message,
  detail,
  actions
}: {
  eyebrow: string;
  title: string;
  message: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="app-outcome__panel">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{message}</p>
      {detail ? <p className="app-outcome__detail">{detail}</p> : null}
      {actions ? <div className="app-outcome__actions">{actions}</div> : null}
    </div>
  );
}
