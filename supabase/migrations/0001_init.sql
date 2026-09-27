-- Kalima — initial schema (ARCHITECTURE.md §7).
-- MVP: no embeddings / pgvector; Q&A sends the full course text.
-- Every user table has RLS. Service-role code (API routes) bypasses RLS where noted.

-- ── helpers ────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── profiles (1 row per auth user, created automatically) ─────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  voice text,
  rate real not null default 1 check (rate between 0.5 and 2),
  detail_level text not null default 'normal' check (detail_level in ('short', 'normal', 'detailed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── courses ────────────────────────────────────────────────────────────────
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_type text not null check (source_type in ('pdf', 'web')),
  title text,
  source_url text,
  storage_path text,
  platform text,
  lang text not null default 'fr' check (lang in ('fr', 'en')),
  content_hash text,
  status text not null default 'uploading'
    check (status in ('uploading', 'ingesting', 'planning', 'ready', 'error')),
  page_count int,
  pages_done int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index courses_user_id_idx on public.courses (user_id);
create index courses_content_hash_idx on public.courses (user_id, content_hash);

create trigger courses_updated_at before update on public.courses
  for each row execute function public.set_updated_at();

-- ── course_pages: raw ingestion output, one row per PDF page / web section (resumable) ──
create table public.course_pages (
  course_id uuid not null references public.courses (id) on delete cascade,
  page_no int not null,
  text text not null default '',
  image_path text,
  figure_descriptions jsonb not null default '[]',
  created_at timestamptz not null default now(),
  primary key (course_id, page_no)
);

-- ── chunks: ordered teachable units produced by the planner ────────────────
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  idx int not null,
  title text not null,
  content text not null,
  figure_descriptions jsonb not null default '[]',
  page_ref text,
  created_at timestamptz not null default now(),
  unique (course_id, idx)
);

-- ── image_descriptions: shared cache keyed by image hash (no personal data) ──
create table public.image_descriptions (
  image_hash text not null,
  lang text not null check (lang in ('fr', 'en')),
  short text not null,
  detailed text not null,
  model text not null,
  created_at timestamptz not null default now(),
  primary key (image_hash, lang)
);

-- ── lesson_sessions: where the learner is in a course ──────────────────────
create table public.lesson_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status text not null default 'EXPLAINING'
    check (status in ('INGESTING', 'PLANNING', 'EXPLAINING', 'PAUSED', 'ANSWERING', 'QUIZ', 'EVALUATED', 'DONE')),
  mode text not null default 'normal' check (mode in ('normal', 'review')),
  current_chunk_idx int not null default 0,
  sentence_offset int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lesson_sessions_course_id_idx on public.lesson_sessions (course_id);
create index lesson_sessions_user_id_idx on public.lesson_sessions (user_id);

create trigger lesson_sessions_updated_at before update on public.lesson_sessions
  for each row execute function public.set_updated_at();

-- ── messages: explanations (cached per chunk), questions and answers ──────
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.lesson_sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  kind text not null check (kind in ('explain', 'review', 'question', 'answer')),
  chunk_idx int,
  lang text not null default 'fr' check (lang in ('fr', 'en')),
  content text not null,
  created_at timestamptz not null default now()
);

create index messages_session_id_idx on public.messages (session_id, chunk_idx);

-- ── quizzes & attempts ────────────────────────────────────────────────────
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.lesson_sessions (id) on delete cascade,
  questions jsonb not null,
  created_at timestamptz not null default now()
);

create index quizzes_session_id_idx on public.quizzes (session_id);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  answers jsonb not null,
  results jsonb not null,
  score real not null,
  weak_chunk_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index quiz_attempts_quiz_id_idx on public.quiz_attempts (quiz_id);

-- ── usage_events: anonymous impact metrics (written by the API with the service role) ──
create table public.usage_events (
  id bigint generated always as identity primary key,
  anon_id text not null,
  event text not null,
  platform text,
  duration_ms int,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index usage_events_event_created_idx on public.usage_events (event, created_at);

-- ── Row Level Security ─────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.course_pages enable row level security;
alter table public.chunks enable row level security;
alter table public.image_descriptions enable row level security;
alter table public.lesson_sessions enable row level security;
alter table public.messages enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.usage_events enable row level security;

-- Own profile only (rows are created by the trigger, never deleted by the user).
create policy "own profile: read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "own profile: update" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Own courses.
create policy "own courses" on public.courses
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Pages and chunks belong to the owner of their course.
create policy "own course pages" on public.course_pages
  for all to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.courses c where c.id = course_id and c.user_id = (select auth.uid())));

create policy "own chunks" on public.chunks
  for all to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.courses c where c.id = course_id and c.user_id = (select auth.uid())));

-- Shared description cache: anyone signed in may read; only the service role writes.
create policy "read image descriptions" on public.image_descriptions
  for select to authenticated using (true);

-- Own sessions (and the session must be on one of your courses).
create policy "own sessions" on public.lesson_sessions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.courses c where c.id = course_id and c.user_id = (select auth.uid()))
  );

create policy "own messages" on public.messages
  for all to authenticated
  using (exists (select 1 from public.lesson_sessions s where s.id = session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.lesson_sessions s where s.id = session_id and s.user_id = (select auth.uid())));

create policy "own quizzes" on public.quizzes
  for all to authenticated
  using (exists (select 1 from public.lesson_sessions s where s.id = session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.lesson_sessions s where s.id = session_id and s.user_id = (select auth.uid())));

create policy "own quiz attempts" on public.quiz_attempts
  for all to authenticated
  using (exists (
    select 1 from public.quizzes q join public.lesson_sessions s on s.id = q.session_id
    where q.id = quiz_id and s.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.quizzes q join public.lesson_sessions s on s.id = q.session_id
    where q.id = quiz_id and s.user_id = (select auth.uid())
  ));

-- usage_events: no client policies at all — only the service role (API) reads or writes.

-- ── Storage: private bucket, each user only touches files under "<their uid>/..." ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-files', 'course-files', false, 52428800,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "course files: own folder read" on storage.objects
  for select to authenticated
  using (bucket_id = 'course-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "course files: own folder insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'course-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "course files: own folder update" on storage.objects
  for update to authenticated
  using (bucket_id = 'course-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'course-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "course files: own folder delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'course-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
