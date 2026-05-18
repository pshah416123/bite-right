-- Run this after the migration to verify all Phase 1 objects exist.
-- Expected output: 3 rows, all with status = 'OK'

select
  t.table_name,
  case when t.table_name is not null then 'OK' else 'MISSING' end as status,
  (select count(*) from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = t.table_name) as column_count
from (values ('restaurants'), ('logs'), ('saved_restaurants')) as t(table_name)
left join information_schema.tables it
  on it.table_schema = 'public' and it.table_name = t.table_name
order by t.table_name;
