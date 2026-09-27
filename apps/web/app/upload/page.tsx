"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";
import { t as tr, type Locale } from "@/lib/i18n";
import { parsePdf } from "@/lib/pdf";

const PARALLEL_PAGES = 3;

export default function UploadPage() {
  const router = useRouter();
  const [lang, setLang] = useState<Locale>("fr");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const t = (k: Parameters<typeof tr>[0]) => tr(k, lang);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setError(t("upload.pickFile"));
    setError("");
    setBusy(true);
    try {
      setStatus(t("upload.reading"));
      const pdf = await parsePdf(file);
      const { courseId } = await api.call<{ courseId: string }>("POST", "/api/courses", {
        title: pdf.title ?? undefined,
        lang,
        pageCount: pdf.pageCount,
      });

      let done = 0;
      const inFlight = new Set<Promise<void>>();
      for await (const page of pdf.pages) {
        const p = api
          .call("POST", `/api/courses/${courseId}/pages`, page)
          .then(() => {
            done++;
            setStatus(t("upload.progress").replace("{n}", String(done)).replace("{total}", String(pdf.pageCount)));
          })
          .finally(() => inFlight.delete(p));
        inFlight.add(p);
        if (inFlight.size >= PARALLEL_PAGES) await Promise.race(inFlight);
      }
      await Promise.all(inFlight);

      setStatus(t("upload.planning"));
      await api.call("POST", `/api/courses/${courseId}/plan`, {});
      setStatus(t("upload.ready"));
      router.push(`/course/${courseId}`);
    } catch (err) {
      console.error(err);
      setError(t("upload.failed"));
      setStatus("");
      setBusy(false);
    }
  }

  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="text-4xl font-bold text-primary-strong">{t("upload.title")}</h1>
      <p className="mt-4 text-lg">{t("upload.intro")}</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-6 rounded-2xl bg-surface p-6">
        <div className="flex flex-col gap-2">
          <label htmlFor="file" className="text-lg font-semibold">
            {t("upload.fileLabel")}
          </label>
          <input
            id="file"
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            required
            disabled={busy}
            className="min-h-12 rounded-lg border-2 border-border bg-background p-2 text-lg file:mr-4 file:min-h-10 file:rounded-md file:border-0 file:bg-primary file:px-4 file:font-semibold file:text-primary-foreground"
          />
        </div>

        <fieldset className="flex flex-col gap-2" disabled={busy}>
          <legend className="text-lg font-semibold">{t("upload.langLabel")}</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {(["fr", "en"] as const).map((l) => (
              <label
                key={l}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-2 border-border bg-background px-4 text-lg has-checked:border-primary has-checked:font-bold"
              >
                <input type="radio" name="lang" value={l} checked={lang === l} onChange={() => setLang(l)} className="size-5 accent-primary" />
                {l === "fr" ? "Français" : "English"}
              </label>
            ))}
          </div>
        </fieldset>

        <button type="submit" disabled={busy} className={buttonVariants({ size: "lg" })}>
          {busy ? t("upload.working") : t("upload.submit")}
        </button>

        <p role="status" aria-live="polite" className="min-h-7 text-lg">
          {status}
        </p>
        {error && (
          <p role="alert" className="rounded-lg bg-secondary-tint p-3 text-lg font-semibold text-secondary">
            <span aria-hidden="true">✗ </span>
            {error}
          </p>
        )}
      </form>

      <Link href="/" className="mt-8 inline-block text-lg text-primary-strong underline underline-offset-4">
        {t("upload.back")}
      </Link>
    </main>
  );
}
