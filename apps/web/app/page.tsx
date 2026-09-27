import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export default function Home() {
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl rounded-2xl bg-surface p-8 sm:p-12">
        <h1 className="text-5xl font-bold tracking-tight text-primary-strong">{t("app.name")}</h1>
        <p className="mt-6 text-xl leading-relaxed text-foreground">{t("app.tagline")}</p>
        <Link href="/upload" className={buttonVariants({ size: "lg", className: "mt-10" })}>
          {t("home.upload")}
        </Link>
      </div>
    </main>
  );
}
