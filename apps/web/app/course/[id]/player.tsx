"use client";

import { LessonPlayer } from "@kalima/ui";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export function CoursePlayer({ courseId }: { courseId: string }) {
  const router = useRouter();
  return <LessonPlayer api={api.lesson} courseId={courseId} onExit={() => router.push("/")} />;
}
