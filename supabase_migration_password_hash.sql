-- =========================================================
-- SmartWay Migration: Add password_hash to smartway_profiles
-- Run this script in Supabase Project -> SQL Editor
-- =========================================================

-- 1. Add password_hash column if it doesn't exist
ALTER TABLE public.smartway_profiles 
ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 2. Allow updates on smartway_profiles via public/anon role
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'smartway_profiles' AND policyname = 'Allow public update on smartway_profiles'
    ) THEN
        CREATE POLICY "Allow public update on smartway_profiles"
            ON public.smartway_profiles FOR UPDATE USING (true);
    END IF;
END
$$;

-- 3. Update existing driver and admin accounts with bcrypt-hashed passwords (rounds=12)
-- Password '123' bcrypt hash:
UPDATE public.smartway_profiles
SET password_hash = '$2b$12$piYrz.nzok9rqp96okrQQOczBaqFRghlJH7XiFY6HX6LNqAuC4r0K'
WHERE username IN ('driver1', 'driver2') AND (password_hash IS NULL OR password_hash = '');

-- Password 'admin' bcrypt hash:
UPDATE public.smartway_profiles
SET password_hash = '$2b$12$FWopysXu0rKYwnDdHpHYaemPCIerX4WiTCNh3CDEeb4GHlZPbBSUW'
WHERE username = 'admin' AND (password_hash IS NULL OR password_hash = '');
