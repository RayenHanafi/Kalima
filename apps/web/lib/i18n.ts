// Minimal dictionary until the full i18n pass in phase 5. Keys only in components.
export const locales = ["fr", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "fr";

const dict = {
  fr: {
    "app.name": "Kalima",
    "app.tagline":
      "Kalima transforme vos cours — PDF ou page e-learning — en leçons parlées et interactives, pensées pour les personnes aveugles et malvoyantes.",
    "home.upload": "Importer un cours",
    "home.skip": "Aller au contenu principal",
    "upload.title": "Importer un cours",
    "upload.soon": "L’import de PDF arrive bientôt.",
    "upload.back": "Retour à l’accueil",
  },
  en: {
    "app.name": "Kalima",
    "app.tagline":
      "Kalima turns your courses — PDFs or e-learning pages — into spoken, interactive lessons designed for blind and low-vision learners.",
    "home.upload": "Upload a course",
    "home.skip": "Skip to main content",
    "upload.title": "Upload a course",
    "upload.soon": "PDF upload is coming soon.",
    "upload.back": "Back to home",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type MessageKey = keyof (typeof dict)["fr"];

export function t(key: MessageKey, locale: Locale = defaultLocale): string {
  return dict[locale][key];
}
