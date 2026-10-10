import type { OpportunityScore } from "@raring2go/advertising";

const bandLabel = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;

/** The score and why: the badge shows the number and band, and the details list every factor with its points. */
export function ScoreBadge({ score }: { score: OpportunityScore | null }) {
  if (!score) return <span className="muted">Not scored (closed)</span>;
  return (
    <details>
      <summary>
        <strong>{score.score}</strong> {bandLabel[score.band]}
      </summary>
      <ul aria-label="How this score is made up">
        {score.factors.map((factor) => (
          <li key={factor.key}>
            {factor.points >= 0 ? "+" : ""}{factor.points} {factor.label}: {factor.detail}
          </li>
        ))}
      </ul>
      <p className="muted">Score definition {score.version}. It is worked out when you view it, so it is always current.</p>
    </details>
  );
}
