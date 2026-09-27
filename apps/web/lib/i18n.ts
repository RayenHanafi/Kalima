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
    "upload.intro":
      "Choisissez un cours au format PDF. Kalima le lit, décrit ses images et schémas, puis vous l’explique à voix haute, partie par partie. Le fichier reste sur votre appareil : seul son texte est envoyé.",
    "upload.fileLabel": "Fichier PDF du cours",
    "upload.langLabel": "Langue de la leçon",
    "upload.submit": "Préparer ma leçon",
    "upload.working": "Préparation en cours…",
    "upload.pickFile": "Choisissez d’abord un fichier PDF.",
    "upload.reading": "Lecture du fichier…",
    "upload.progress": "Analyse de la page {n} sur {total}…",
    "upload.planning": "Préparation du plan de la leçon…",
    "upload.ready": "Votre leçon est prête.",
    "upload.failed": "Impossible de préparer ce cours. Vérifiez que c’est bien un PDF, puis réessayez.",
    "upload.back": "Retour à l’accueil",
  },
  en: {
    "app.name": "Kalima",
    "app.tagline":
      "Kalima turns your courses — PDFs or e-learning pages — into spoken, interactive lessons designed for blind and low-vision learners.",
    "home.upload": "Upload a course",
    "home.skip": "Skip to main content",
    "upload.title": "Upload a course",
    "upload.intro":
      "Choose a course PDF. Kalima reads it, describes its images and diagrams, then explains it to you out loud, part by part. The file stays on your device: only its text is sent.",
    "upload.fileLabel": "Course PDF file",
    "upload.langLabel": "Lesson language",
    "upload.submit": "Prepare my lesson",
    "upload.working": "Preparing…",
    "upload.pickFile": "Choose a PDF file first.",
    "upload.reading": "Reading the file…",
    "upload.progress": "Analysing page {n} of {total}…",
    "upload.planning": "Preparing the lesson plan…",
    "upload.ready": "Your lesson is ready.",
    "upload.failed": "Couldn't prepare this course. Check that it is a PDF, then try again.",
    "upload.back": "Back to home",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type MessageKey = keyof (typeof dict)["fr"];

export function t(key: MessageKey, locale: Locale = defaultLocale): string {
  return dict[locale][key];
}
