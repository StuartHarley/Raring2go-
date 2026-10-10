import Link from "next/link";

/**
 * The product's brand mark: the Raring2go! wordmark in the brand purple with the
 * "Business-in-a-Box" product name beneath it.
 *
 * The 2018 guidelines define a drawn logo with clear-space rules, but no production vector has
 * been supplied to the repo yet (see docs/DESIGN_SYSTEM.md). This wordmark is set in the brand
 * type stack and uses only the primary colours, so it can be swapped for the real logo asset
 * without touching any page.
 */
export function BrandMark({ href = "/app", product = "Business-in-a-Box" }: { href?: "/app" | "/"; product?: string | null }) {
  return (
    <Link href={href} className="brand-mark" aria-label={`Raring2go! ${product ?? ""}`.trim()}>
      <span className="brand-mark__icon" aria-hidden="true">
        R!
      </span>
      <span className="brand-mark__text">
        <span className="brand-mark__name">Raring2go!</span>
        {product ? <span className="brand-mark__product">{product}</span> : null}
      </span>
    </Link>
  );
}
