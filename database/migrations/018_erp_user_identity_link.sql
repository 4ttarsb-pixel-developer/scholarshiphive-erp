-- Bind Marketing profiles to the immutable central ERP identity, not mutable email.
ALTER TABLE marketing.users
  ADD COLUMN erp_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL;

UPDATE marketing.users mu
SET erp_user_id = pu.id
FROM public.users pu
WHERE lower(mu.email) = lower(pu.email)
  AND mu.erp_user_id IS NULL;

CREATE UNIQUE INDEX marketing_users_erp_user_id_key
  ON marketing.users (erp_user_id)
  WHERE erp_user_id IS NOT NULL;
