alter table public.monitors add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();
alter table public.monitors alter column user_id set not null;

drop policy if exists monitors_public_select on public.monitors;
drop policy if exists monitors_public_insert on public.monitors;
drop policy if exists monitors_public_update on public.monitors;
drop policy if exists monitors_public_delete on public.monitors;
drop policy if exists monitor_checks_public_select on public.monitor_checks;
drop policy if exists monitor_checks_public_insert on public.monitor_checks;

create policy monitors_authenticated_select on public.monitors for select to authenticated using (user_id = auth.uid());
create policy monitors_authenticated_insert on public.monitors for insert to authenticated with check (user_id = auth.uid());
create policy monitors_authenticated_update on public.monitors for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy monitors_authenticated_delete on public.monitors for delete to authenticated using (user_id = auth.uid());
create policy monitor_checks_authenticated_select on public.monitor_checks for select to authenticated using (exists (select 1 from public.monitors where monitors.id = monitor_checks.monitor_id and monitors.user_id = auth.uid()));
create policy monitor_checks_authenticated_insert on public.monitor_checks for insert to authenticated with check (exists (select 1 from public.monitors where monitors.id = monitor_checks.monitor_id and monitors.user_id = auth.uid()));
