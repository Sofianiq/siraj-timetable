-- =====================================================================================
-- نظام إدارة الجداول الدراسية — قاعدة بيانات Supabase
-- التشغيل: Supabase ← SQL Editor ← New query ← الصق هذا الملف كاملاً ← Run.
-- آمن لإعادة التشغيل (لا يحذف بيانات). الجداول تبدأ بـ tt_ فلا تتعارض مع أي نظام آخر في المشروع نفسه.
-- =====================================================================================

-- ------------------------------ الجداول ------------------------------
-- كل بيانات النظام (الكليات، الأقسام، المراحل، الشعب، الأساتذة، القاعات، المواد، المحاضرات، الإعدادات)
-- في جدول واحد: col = نوع البيانات، id = المعرّف، data = الحقول (كما في نسخة Firebase تماماً).
create table if not exists public.tt_docs (
  col        text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);

-- ملفات المستخدمين وصلاحياتهم: data = {name, role: viewer|dept|college|admin, deptId, collegeId, createdAt}
create table if not exists public.tt_profiles (
  id         uuid        primary key references auth.users (id) on delete cascade,
  email      text,
  data       jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- مديرو النظام (المشرف العام). لا يُقرأ ولا يُعدَّل من الموقع، فقط من هنا.
create table if not exists public.tt_super_admins (email text primary key);
-- ⚠️ ضع بريدك هنا (نفس البريد في SUPER_ADMIN_EMAILS في js/config.js):
insert into public.tt_super_admins (email) values ('sofian.7.4.96@gmail.com') on conflict do nothing;

alter table public.tt_docs         enable row level security;
alter table public.tt_profiles     enable row level security;
alter table public.tt_super_admins enable row level security;  -- بلا سياسات: غير متاح عبر الموقع

-- ------------------------------ دوال الصلاحيات ------------------------------
-- (security definer حتى تقرأ الملفات دون الدخول في حلقة سياسات الأمان)
create or replace function public.tt_my_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select data from public.tt_profiles where id = auth.uid()
$$;

create or replace function public.tt_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.tt_super_admins s
            where lower(s.email) = lower(coalesce((select email from auth.users where id = auth.uid()), '')))
    or coalesce((select data ->> 'role' from public.tt_profiles where id = auth.uid()), '') = 'admin'
  )
$$;

create or replace function public.tt_dept_college(dept text) returns text
language sql stable security definer set search_path = public as $$
  select data ->> 'collegeId' from public.tt_docs where col = 'departments' and id = dept
$$;

-- قواعد الكتابة (مطابقة لقواعد Firebase):
--   مدير النظام: كل شيء.
--   معاون العميد (college): أقسام كليته وقاعاتها، وكل بيانات أقسامها (مراحل، شعب، مواد، أساتذة، محاضرات).
--   مسؤول القسم (dept): مراحل قسمه وشعبه وموادّه وأساتذته ومحاضراته.
--   عرض فقط والزوار: لا شيء.
create or replace function public.tt_can_write(c text, d jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  p jsonb;
  r text;
begin
  if public.tt_is_admin() then return true; end if;
  if auth.uid() is null then return false; end if;
  p := public.tt_my_profile();
  r := coalesce(p ->> 'role', 'viewer');
  if c in ('stages', 'groups', 'subjects', 'sessions', 'teachers') then
    if coalesce(d ->> 'deptId', '') = '' then return false; end if;
    if r = 'dept' then return d ->> 'deptId' = p ->> 'deptId'; end if;
    if r = 'college' then return public.tt_dept_college(d ->> 'deptId') = p ->> 'collegeId'; end if;
    return false;
  end if;
  if c in ('departments', 'rooms') then
    return r = 'college' and coalesce(d ->> 'collegeId', '') <> '' and d ->> 'collegeId' = p ->> 'collegeId';
  end if;
  return false;
end $$;

-- ------------------------------ سياسات الأمان ------------------------------
-- القراءة متاحة للجميع (الطلبة يفتحون رابط الجدول دون تسجيل)، والكتابة حسب الصلاحية.
drop policy if exists tt_docs_read   on public.tt_docs;
drop policy if exists tt_docs_insert on public.tt_docs;
drop policy if exists tt_docs_update on public.tt_docs;
drop policy if exists tt_docs_delete on public.tt_docs;
create policy tt_docs_read   on public.tt_docs for select using (true);
create policy tt_docs_insert on public.tt_docs for insert with check (public.tt_can_write(col, data));
create policy tt_docs_update on public.tt_docs for update using (public.tt_can_write(col, data)) with check (public.tt_can_write(col, data));
create policy tt_docs_delete on public.tt_docs for delete using (public.tt_can_write(col, data));

-- المستخدم يقرأ ملفه وينشئه أول مرة بصلاحية «عرض فقط»، والمدير يقرأ ويعدّل الجميع.
drop policy if exists tt_profiles_read   on public.tt_profiles;
drop policy if exists tt_profiles_insert on public.tt_profiles;
drop policy if exists tt_profiles_update on public.tt_profiles;
drop policy if exists tt_profiles_delete on public.tt_profiles;
create policy tt_profiles_read   on public.tt_profiles for select using (id = auth.uid() or public.tt_is_admin());
create policy tt_profiles_insert on public.tt_profiles for insert
  with check (id = auth.uid() and coalesce(data ->> 'role', 'viewer') = 'viewer');
create policy tt_profiles_update on public.tt_profiles for update using (public.tt_is_admin()) with check (public.tt_is_admin());
create policy tt_profiles_delete on public.tt_profiles for delete using (public.tt_is_admin());

-- ------------------------------ الكتابة دفعة واحدة ------------------------------
-- يطبّق مجموعة عمليات [{op: set|update|delete, col, id, data}] كوحدة واحدة (تنجح كلها أو لا شيء)،
-- مع تطبيق سياسات الأمان على كل عملية (security invoker).
create or replace function public.tt_apply(ops jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  o jsonb;
  n int;
begin
  for o in select value from jsonb_array_elements(ops) loop
    if o ->> 'col' = 'users' then
      if o ->> 'op' = 'delete' then
        delete from public.tt_profiles where id = (o ->> 'id')::uuid;
      else
        update public.tt_profiles set data = data || coalesce(o -> 'data', '{}'::jsonb) where id = (o ->> 'id')::uuid;
      end if;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'غير مسموح بتعديل المستخدم (صلاحية مدير النظام فقط)' using errcode = '42501'; end if;
      continue;
    end if;

    if o ->> 'op' = 'delete' then
      delete from public.tt_docs where col = o ->> 'col' and id = o ->> 'id';
      get diagnostics n = row_count;
      if n = 0 and exists (select 1 from public.tt_docs where col = o ->> 'col' and id = o ->> 'id') then
        raise exception 'لا تملك صلاحية الحذف في هذا القسم أو الكلية' using errcode = '42501';
      end if;
    elsif o ->> 'op' = 'update' then
      update public.tt_docs set data = data || coalesce(o -> 'data', '{}'::jsonb), updated_at = now()
       where col = o ->> 'col' and id = o ->> 'id';
      get diagnostics n = row_count;
      if n = 0 and exists (select 1 from public.tt_docs where col = o ->> 'col' and id = o ->> 'id') then
        raise exception 'لا تملك صلاحية التعديل في هذا القسم أو الكلية' using errcode = '42501';
      end if;
    else
      insert into public.tt_docs (col, id, data) values (o ->> 'col', o ->> 'id', coalesce(o -> 'data', '{}'::jsonb))
      on conflict (col, id) do update set data = excluded.data, updated_at = now();
    end if;
  end loop;
end $$;

grant execute on function public.tt_apply(jsonb) to anon, authenticated;

-- ------------------------------ المزامنة الفورية ------------------------------
alter table public.tt_docs     replica identity full;
alter table public.tt_profiles replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.tt_docs;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.tt_profiles;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
