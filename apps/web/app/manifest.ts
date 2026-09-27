import type { MetadataRoute } from "next";

// Installable web app (PWA): "Add to home screen" on phones, standalone window on desktop.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kalima — leçons parlées et accessibles",
    short_name: "Kalima",
    description: "Transforme vos cours en leçons parlées et interactives pour les personnes aveugles et malvoyantes.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#15803d",
    lang: "fr",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
