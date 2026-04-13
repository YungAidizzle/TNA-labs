import type { Metadata } from "next";
import { BRAND_DESCRIPTOR, BRAND_META_DESCRIPTION, BRAND_NAME } from "@/lib/brand";

type BuildPageMetadataInput = {
  title: string;
  description: string;
  path?: string;
  robots?: Metadata["robots"];
};

const DEFAULT_OG_IMAGE = "/opengraph-image";
const DEFAULT_TWITTER_IMAGE = "/twitter-image";

export function buildPageMetadata({
  title,
  description,
  path,
  robots,
}: BuildPageMetadataInput): Metadata {
  const url = path || "/";

  return {
    title,
    description,
    robots,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: `${title} | ${BRAND_NAME}`,
      description,
      siteName: BRAND_NAME,
      type: "website",
      url,
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: `${BRAND_NAME} social preview`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${BRAND_NAME}`,
      description,
      images: [DEFAULT_TWITTER_IMAGE],
    },
  };
}

export const DEFAULT_SITE_METADATA = buildPageMetadata({
  title: BRAND_DESCRIPTOR,
  description: BRAND_META_DESCRIPTION,
});
