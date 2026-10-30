-- Grant staff access to an existing Supabase Auth user.
-- 1. Dashboard → Authentication → Users → "Add user" → "Create new user"
--    (enter email + password, tick "Auto Confirm User").
-- 2. Replace the email below and run this in the SQL Editor.

insert into public.staff (user_id, display_name)
select id, 'Front desk'
from auth.users
where email = 'staff@example.com'
on conflict (user_id) do nothing;

-- Check:
select s.display_name, u.email from public.staff s join auth.users u on u.id = s.user_id;

-- Revoke access:
-- delete from public.staff where user_id = (select id from auth.users where email = 'staff@example.com');
