-- =========================================================
-- SmartWay: Emergency Response & Fleet Database Schema
-- Run this script in your Supabase Project -> SQL Editor
-- =========================================================

-- 1. Profiles Table (Drivers & Administrators)
CREATE TABLE IF NOT EXISTS public.smartway_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('driver', 'admin')),
    vehicle_id TEXT,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS and create public read/write/update policies
ALTER TABLE public.smartway_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on smartway_profiles"
    ON public.smartway_profiles FOR SELECT USING (true);

CREATE POLICY "Allow public insert on smartway_profiles"
    ON public.smartway_profiles FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update on smartway_profiles"
    ON public.smartway_profiles FOR UPDATE USING (true);

-- Seed initial driver and admin accounts (Passwords stored as salted bcrypt hashes)
-- 'driver1' & 'driver2' password: '123'
-- 'admin' password: 'admin'
INSERT INTO public.smartway_profiles (username, full_name, role, vehicle_id, password_hash)
VALUES 
    ('driver1', 'Rajesh Kumar (Rapid Response)', 'driver', 'AMB-108', '$2b$12$piYrz.nzok9rqp96okrQQOczBaqFRghlJH7XiFY6HX6LNqAuC4r0K'),
    ('driver2', 'Priya Sharma (Trauma Unit)', 'driver', 'AMB-102', '$2b$12$piYrz.nzok9rqp96okrQQOczBaqFRghlJH7XiFY6HX6LNqAuC4r0K'),
    ('admin', 'Hyderabad Emergency Command', 'admin', 'HQ-CONTROL', '$2b$12$FWopysXu0rKYwnDdHpHYaemPCIerX4WiTCNh3CDEeb4GHlZPbBSUW')
ON CONFLICT (username) DO UPDATE SET 
    password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name,
    vehicle_id = EXCLUDED.vehicle_id;

-- 2. Trips & Missions Table
CREATE TABLE IF NOT EXISTS public.smartway_trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id TEXT UNIQUE NOT NULL,
    driver_name TEXT NOT NULL,
    driver_id TEXT DEFAULT 'driver1',
    vehicle_id TEXT DEFAULT 'AMB-108',
    source_name TEXT NOT NULL,
    source_lat FLOAT,
    source_lon FLOAT,
    destination_name TEXT NOT NULL,
    destination_lat FLOAT,
    destination_lon FLOAT,
    route_length_m FLOAT NOT NULL,
    signals_count INT NOT NULL DEFAULT 0,
    signals_bypassed INT NOT NULL DEFAULT 0,
    time_taken_seconds INT NOT NULL DEFAULT 0,
    time_saved_seconds INT NOT NULL DEFAULT 0,
    average_speed_kmh FLOAT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS and create public read/write policy for app
ALTER TABLE public.smartway_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on smartway_trips"
    ON public.smartway_trips FOR SELECT USING (true);

CREATE POLICY "Allow public insert on smartway_trips"
    ON public.smartway_trips FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update on smartway_trips"
    ON public.smartway_trips FOR UPDATE USING (true);
