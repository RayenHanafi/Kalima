import type { Metadata } from "next";
import Link from "next/link";
import { serviceDb } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Impact — Kalima" };

type Row = { anon_id: string; event: string; platform: string | null; duration_ms: number | null; meta: unknown };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** Anonymous, aggregated impact indicators (PROJECT.md §8). No personal data is stored or shown. */
export default async function Dashboard() {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data } = await serviceDb()
    .from("usage_events")
    .select("anon_id, event, platform, duration_ms, meta")
    .gte("created_at", since)
    .limit(10000);
  const rows = (data ?? []) as Row[];
  const of = (e: string) => rows.filter((r) => r.event === e);

  const started = of("session_started").length;
  const completed = of("session_completed").length;
  const quizzes = of("quiz_submitted");
  const scores = quizzes.map((r) => (r.meta as { score?: number })?.score).filter((s): s is number => typeof s === "number");
  const firstWord = median(of("chunk_explained").map((r) => r.duration_ms).filter((d): d is number => typeof d === "number"));
  const learners = new Set(rows.map((r) => r.anon_id)).size;
  const byPlatform = new Map<string, number>();
  for (const r of of("course_created")) byPlatform.set(r.platform ?? "?", (byPlatform.get(r.platform ?? "?") ?? 0) + 1);

  const stats: [string, string][] = [
    ["Apprenants (anonymes)", String(learners)],
    ["Cours préparés", String(of("course_created").length)],
    ["Sessions de leçon", String(started)],
    ["Leçons terminées", `${completed}${started ? ` (${Math.round((completed / started) * 100)} %)` : ""}`],
    ["Parties expliquées", String(of("chunk_explained").length)],
    ["Questions posées", String(of("question_asked").length)],
    ["Quiz passés", String(quizzes.length)],
    ["Score moyen au quiz", scores.length ? `${Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100)} %` : "—"],
    ["Délai médian avant la première parole", firstWord === null ? "—" : `${(firstWord / 1000).toFixed(1)} s`],
  ];

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-4xl font-bold text-primary-strong">Impact de Kalima</h1>
      <p className="mt-3 text-lg text-text-muted">
        Indicateurs anonymes des 90 derniers jours. Aucun nom, e-mail ou contenu de cours n’est enregistré.
      </p>
      <table className="mt-8 w-full border-collapse text-lg">
        <caption className="sr-only">Indicateurs d’impact</caption>
        <thead>
          <tr className="border-b-2 border-border text-left">
            <th scope="col" className="py-3">Indicateur</th>
            <th scope="col" className="py-3 text-right">Valeur</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(([k, v]) => (
            <tr key={k} className="border-b border-border/40">
              <th scope="row" className="py-3 text-left font-normal">{k}</th>
              <td className="py-3 text-right font-bold">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {byPlatform.size > 0 && (
        <>
          <h2 className="mt-10 text-2xl font-bold">Sources des cours</h2>
          <ul className="mt-3 space-y-1 text-lg">
            {[...byPlatform].map(([p, n]) => (
              <li key={p}>
                {p === "pdf" ? "PDF importé" : p === "generic" ? "Page web" : p} : <strong>{n}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link href="/" className="mt-10 inline-block text-lg text-primary-strong underline underline-offset-4">
        Retour à l’accueil
      </Link>
    </main>
  );
}
