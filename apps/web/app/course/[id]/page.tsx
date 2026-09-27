import { CoursePlayer } from "./player";

export default async function CoursePage(props: PageProps<"/course/[id]">) {
  const { id } = await props.params;
  return (
    <main id="main" className="flex-1">
      <CoursePlayer courseId={id} />
    </main>
  );
}
