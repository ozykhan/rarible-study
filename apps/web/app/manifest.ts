import type { MetadataRoute } from "next"

/**
 * The web manifest, so a phone's "Add to Home Screen" gets the mark and the
 * canvas color. The icons come from scripts/make_icons.py.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Slabwatch",
    short_name: "Slabwatch",
    start_url: "/",
    background_color: "#080808",
    theme_color: "#080808",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  }
}
