import { z } from "zod";
import { aiFailure, fail, readJson } from "@/lib/http";
import { planCourse, PlanError } from "@/lib/lesson/plan";
import { authenticate } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ force: z.boolean().optional() });

/** Turns the ingested pages into ordered teachable chunks (idempotent unless force=true). */
export async function POST(req: Request, ctx: RouteContext<"/api/courses/[id]/plan">) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req, Body);
  if (body instanceof Response) return body;
  const { id } = await ctx.params;
  try {
    return Response.json(await planCourse(auth.db, id, { force: body.force, signal: req.signal }));
  } catch (err) {
    if (err instanceof PlanError) return fail(err.code === "course_not_found" ? 404 : 409, err.code);
    return aiFailure(err);
  }
}
