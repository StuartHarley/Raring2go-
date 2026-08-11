import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/areas/"],
      disallow: ["/app/", "/auth/", "/context"]
    },
    sitemap: `${baseUrl.replace(/\/$/, "")}/sitemap.xml`
  };
}
