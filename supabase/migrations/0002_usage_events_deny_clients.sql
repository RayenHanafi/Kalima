-- usage_events is written and read only by the API with the service role (which bypasses RLS).
-- Make that explicit so clients can never touch it, and the security linter records the intent.
create policy "no client access to usage events" on public.usage_events
  as restrictive for all to anon, authenticated
  using (false)
  with check (false);
