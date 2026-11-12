-- اختبارات صلاحيات قاعدة بيانات الجداول — تُشغَّل عبر supabase/tests/run.sh
\set ON_ERROR_STOP 1
\pset pager off
\o /dev/null
set client_min_messages = warning;
create schema t;
grant usage on schema t to authenticated, anon;
create function t.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm not like p_like then raise exception 'TEST FAIL: expected "%", got: %', p_like, sqlerrm; end if;
    return;
  end;
  raise exception 'TEST FAIL: expected error "%" but succeeded: %', p_like, p_sql;
end $$;
create function t.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'TEST FAIL: %', p_msg; end if; end $$;
grant execute on all functions in schema t to authenticated, anon;

-- المستخدمون (مدير الاختبار يُضاف إلى المشرفين العامين)
insert into public.tt_super_admins (email) values ('admin@example.com') on conflict do nothing;
insert into auth.users values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'head@uni.edu'),
  ('00000000-0000-0000-0000-000000000003', 'dean@uni.edu'),
  ('00000000-0000-0000-0000-000000000004', 'viewer@uni.edu');
\set as_admin 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_head 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_dean 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_viewer 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'

-- المشرف العام (من tt_super_admins) يكتب كل شيء
:as_admin
select t.ok(public.tt_is_admin(), 'super admin');
select public.tt_apply('[
  {"op":"set","col":"colleges","id":"c1","data":{"name":"كلية التقنيات"}},
  {"op":"set","col":"colleges","id":"c2","data":{"name":"كلية الصيدلة"}},
  {"op":"set","col":"departments","id":"d1","data":{"name":"التخدير","collegeId":"c1"}},
  {"op":"set","col":"departments","id":"d2","data":{"name":"الأشعة","collegeId":"c1"}},
  {"op":"set","col":"departments","id":"d3","data":{"name":"الصيدلة","collegeId":"c2"}},
  {"op":"set","col":"settings","id":"app","data":{"dayStart":510,"dayEnd":870}}
]'::jsonb);
select t.ok((select count(*) from public.tt_docs) = 6, 'admin batch insert');
-- update = دمج الحقول
select public.tt_apply('[{"op":"update","col":"settings","id":"app","data":{"dayEnd":900}}]');
select t.ok((select data from public.tt_docs where col='settings' and id='app') = '{"dayStart":510,"dayEnd":900}'::jsonb, 'merge update');

-- المستخدمون الجدد ينشئون ملفاتهم بصلاحية «عرض فقط» فقط
:as_head
insert into public.tt_profiles (id, email, data) values ('00000000-0000-0000-0000-000000000002', 'head@uni.edu', '{"role":"viewer"}');
select t.expect_error($$insert into public.tt_profiles (id, email, data) values ('00000000-0000-0000-0000-000000000003', 'x', '{"role":"viewer"}')$$, '%row-level security%');
:as_dean
select t.expect_error($$insert into public.tt_profiles (id, email, data) values ('00000000-0000-0000-0000-000000000003', 'dean@uni.edu', '{"role":"admin"}')$$, '%row-level security%');
insert into public.tt_profiles (id, email, data) values ('00000000-0000-0000-0000-000000000003', 'dean@uni.edu', '{"role":"viewer"}');
:as_viewer
insert into public.tt_profiles (id, email, data) values ('00000000-0000-0000-0000-000000000004', 'viewer@uni.edu', '{"role":"viewer"}');
-- المستخدم لا يرفع صلاحيته بنفسه
select t.expect_error($$select public.tt_apply('[{"op":"update","col":"users","id":"00000000-0000-0000-0000-000000000004","data":{"role":"admin"}}]')$$, '%غير مسموح%');
select t.ok((select count(*) from public.tt_profiles) = 1, 'user sees only own profile');

-- المدير يمنح الصلاحيات
:as_admin
select t.ok((select count(*) from public.tt_profiles) = 3, 'admin sees all profiles');
select public.tt_apply('[
  {"op":"update","col":"users","id":"00000000-0000-0000-0000-000000000002","data":{"role":"dept","deptId":"d1"}},
  {"op":"update","col":"users","id":"00000000-0000-0000-0000-000000000003","data":{"role":"college","collegeId":"c1"}}
]');

-- مسؤول القسم: قسمه فقط
:as_head
select public.tt_apply('[{"op":"set","col":"sessions","id":"s1","data":{"deptId":"d1","day":1}},{"op":"set","col":"teachers","id":"t1","data":{"deptId":"d1","name":"د. أ"}}]');
select t.expect_error($$select public.tt_apply('[{"op":"set","col":"sessions","id":"s2","data":{"deptId":"d2"}}]')$$, '%row-level security%');
select t.expect_error($$select public.tt_apply('[{"op":"set","col":"rooms","id":"r1","data":{"collegeId":"c1"}}]')$$, '%row-level security%');
select t.expect_error($$select public.tt_apply('[{"op":"set","col":"sessions","id":"s9","data":{"kind":"external"}}]')$$, '%row-level security%');
-- لا ينقل محاضرة إلى قسم آخر
select t.expect_error($$select public.tt_apply('[{"op":"update","col":"sessions","id":"s1","data":{"deptId":"d2"}}]')$$, '%row-level security%');
-- الدفعة كلها تفشل إن فشلت عملية واحدة
select t.expect_error($$select public.tt_apply('[{"op":"set","col":"sessions","id":"s3","data":{"deptId":"d1"}},{"op":"set","col":"sessions","id":"s4","data":{"deptId":"d3"}}]')$$, '%row-level security%');
select t.ok(not exists (select 1 from public.tt_docs where id = 's3'), 'atomic batch');

-- معاون العميد: أقسام كليته وقاعاتها
:as_dean
select public.tt_apply('[{"op":"set","col":"rooms","id":"r1","data":{"collegeId":"c1","name":"قاعة"}},{"op":"set","col":"sessions","id":"s5","data":{"deptId":"d2"}},{"op":"update","col":"departments","id":"d2","data":{"short":"الأشعة"}}]');
select t.expect_error($$select public.tt_apply('[{"op":"set","col":"sessions","id":"s6","data":{"deptId":"d3"}}]')$$, '%row-level security%');
select t.expect_error($$select public.tt_apply('[{"op":"delete","col":"departments","id":"d3"}]')$$, '%صلاحية%');
select t.expect_error($$select public.tt_apply('[{"op":"update","col":"settings","id":"app","data":{"dayEnd":1}}]')$$, '%صلاحية%');

-- عرض فقط والزوار: قراءة فقط
:as_viewer
select t.expect_error($$select public.tt_apply('[{"op":"delete","col":"sessions","id":"s1"}]')$$, '%صلاحية%');
:as_anon
select t.ok((select count(*) from public.tt_docs) >= 9, 'anon can read timetables');
select t.expect_error($$select public.tt_apply('[{"op":"set","col":"sessions","id":"s7","data":{"deptId":"d1"}}]')$$, '%row-level security%');
select t.ok((select count(*) from public.tt_profiles) = 0, 'anon cannot read profiles');

reset role;
\o
select 'ALL TESTS PASSED';
