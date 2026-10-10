import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";
import { readPublicBusiness } from "../../../../../lib/public-runtime";
import { JsonLd, PublicNav, siteUrl } from "../../_components/PublicNav";
import { Track } from "../../_components/Track";

type PageProps = { params: Promise<{ territorySlug: string; advertiserId: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { territorySlug, advertiserId } = await params;
  const found = await readPublicBusiness(territorySlug, advertiserId, siteUrl());
  if (!found) return { title: { absolute: "Not found | Raring2go!" }, robots: { index: false } };

  return {
    title: { absolute: `${found.business.title} | Raring2go! ${found.territory.name}` },
    description: found.business.summary,
    alternates: { canonical: `${siteUrl()}${found.business.href}` }
  };
}

export default async function BusinessPage({ params }: PageProps) {
  const { territorySlug, advertiserId } = await params;
  const found = await readPublicBusiness(territorySlug, advertiserId, siteUrl());
  if (!found) notFound();

  return (
    <main className="public-site public-season-autumn">
      <JsonLd data={found.structuredData} />
      <Track eventType="content_viewed" territorySlug={found.territory.slug} path={found.business.href} entityType="advertiser" entityId={found.business.advertiserId} />
      <PublicNav slug={found.territory.slug} />
      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">
            <Link href={`/areas/${found.territory.slug}/businesses` as Route}>Local businesses</Link> · {found.label}
          </p>
          <h1>{found.business.title}</h1>
          <p>{found.business.summary}</p>
        </div>
      </section>
    </main>
  );
}
