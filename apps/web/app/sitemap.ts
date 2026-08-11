import type { MetadataRoute } from "next";
import { publicSeoRoutes } from "../lib/public-runtime";

export default function sitemap(): MetadataRoute.Sitemap {
  return publicSeoRoutes(siteUrl()).map((route) => ({
    url: route.path,
    changeFrequency: route.changeFrequency,
    priority: route.priority
  }));
}

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
