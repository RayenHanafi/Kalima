import Link from "next/link";
import { t } from "@/lib/i18n";

// Placeholder so the home link works; the real upload flow comes in phase 3.
export default function UploadPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-4xl font-bold text-primary-strong">{t("upload.title")}</h1>
      <p className="mt-6 text-xl" role="status">
        {t("upload.soon")}
      </p>
      <Link href="/" className="mt-8 inline-block text-primary-strong underline underline-offset-4">
        {t("upload.back")}
      </Link>
    </main>
  );
}
