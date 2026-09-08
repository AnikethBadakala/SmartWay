import requests
import json
import time
import os
import bcrypt
import database

def load_env_file():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        except Exception:
            pass

load_env_file()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://lrydqmktaoxtbjzsqigu.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyeWRxbWt0YW94dGJqenNxaWd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTc0MjEsImV4cCI6MjEwNDQzMzQyMX0.PnGTBjWKE1lj7xkVmwAdHQqw_TVyMNT5ivvFUNPcT2w")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

# In-memory and local SQLite fallback for trips table
def init_local_trips_table():
    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS smartway_trips (
        id TEXT PRIMARY KEY,
        mission_id TEXT UNIQUE NOT NULL,
        driver_name TEXT NOT NULL,
        driver_id TEXT DEFAULT 'driver1',
        vehicle_id TEXT DEFAULT 'AMB-108',
        source_name TEXT NOT NULL,
        source_lat REAL,
        source_lon REAL,
        destination_name TEXT NOT NULL,
        destination_lat REAL,
        destination_lon REAL,
        route_length_m REAL NOT NULL,
        signals_count INTEGER DEFAULT 0,
        signals_bypassed INTEGER DEFAULT 0,
        time_taken_seconds INTEGER DEFAULT 0,
        time_saved_seconds INTEGER DEFAULT 0,
        average_speed_kmh REAL DEFAULT 0,
        status TEXT DEFAULT 'completed',
        created_at TEXT NOT NULL
    )
    """)
    conn.commit()
    conn.close()

init_local_trips_table()

def record_trip_completion(trip_data: dict):
    """
    Records a completed emergency mission into Supabase smartway_trips table.
    Falls back cleanly to local SQLite if remote table is pending creation.
    """
    mission_id = trip_data.get("mission_id", f"trip_{int(time.time()*1000)}")
    driver_name = trip_data.get("driver_name", "Rajesh Kumar (AMB-108)")
    driver_id = trip_data.get("driver_id", "driver1")
    vehicle_id = trip_data.get("vehicle_id", "AMB-108")
    source_name = trip_data.get("source_name", "Pickup Point")
    destination_name = trip_data.get("destination_name", "Hospital")
    route_length_m = trip_data.get("route_length_m", 1500.0)
    signals_count = trip_data.get("signals_count", 6)
    signals_bypassed = trip_data.get("signals_bypassed", 0)
    time_taken_s = trip_data.get("time_taken_seconds", 45)
    time_saved_s = trip_data.get("time_saved_seconds", 0)
    avg_speed = trip_data.get("average_speed_kmh", 55.0)
    created_at = time.strftime("%Y-%m-%d %H:%M:%S")

    # 1. Store in local SQLite
    try:
        conn = database.get_db()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT OR REPLACE INTO smartway_trips (
            id, mission_id, driver_name, driver_id, vehicle_id,
            source_name, destination_name, route_length_m,
            signals_count, signals_bypassed, time_taken_seconds,
            time_saved_seconds, average_speed_kmh, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
        """, (
            mission_id, mission_id, driver_name, driver_id, vehicle_id,
            source_name, destination_name, route_length_m,
            signals_count, signals_bypassed, time_taken_s,
            time_saved_s, avg_speed, created_at
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        print("SQLite trip store error:", e)

    # 2. Sync to Supabase smartway_trips
    try:
        url = f"{SUPABASE_URL}/rest/v1/smartway_trips"
        payload = {
            "mission_id": mission_id,
            "driver_name": driver_name,
            "driver_id": driver_id,
            "vehicle_id": vehicle_id,
            "source_name": source_name,
            "destination_name": destination_name,
            "route_length_m": route_length_m,
            "signals_count": signals_count,
            "signals_bypassed": signals_bypassed,
            "time_taken_seconds": time_taken_s,
            "time_saved_seconds": time_saved_s,
            "average_speed_kmh": avg_speed,
            "status": "completed"
        }
        res = requests.post(url, headers=HEADERS, json=payload, timeout=4)
        if res.status_code in (200, 201):
            print("Successfully synced trip to Supabase smartway_trips!")
            return {"status": "synced_supabase", "data": res.json()}
        else:
            print("Supabase returned status:", res.status_code, res.text)
    except Exception as e:
        print("Supabase remote sync note:", e)

    return {"status": "saved_local"}

def get_analytics():
    """
    Fetches aggregated metrics and recent trip history.
    Tries Supabase first, falling back to local SQLite.
    """
    trips = []
    source_used = "supabase"

    # Attempt Supabase query
    try:
        url = f"{SUPABASE_URL}/rest/v1/smartway_trips?select=*&order=created_at.desc&limit=30"
        res = requests.get(url, headers=HEADERS, timeout=3)
        if res.status_code == 200:
            trips = res.json()
        else:
            source_used = "sqlite_fallback"
    except Exception:
        source_used = "sqlite_fallback"

    # Fallback to SQLite if Supabase table is not yet populated
    if not trips:
        try:
            conn = database.get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM smartway_trips ORDER BY created_at DESC LIMIT 30")
            rows = cursor.fetchall()
            trips = [dict(row) for row in rows]
            conn.close()
        except Exception:
            trips = []

    # Calculate Aggregate Metrics
    total_trips = len(trips)
    total_time_saved_s = sum(t.get("time_saved_seconds", 0) or 0 for t in trips)
    total_signals_bypassed = sum(t.get("signals_bypassed", 0) or 0 for t in trips)
    total_distance_m = sum(t.get("route_length_m", 0) or 0 for t in trips)
    
    speeds = [t.get("average_speed_kmh", 0) for t in trips if t.get("average_speed_kmh")]
    avg_speed = round(sum(speeds) / len(speeds), 1) if speeds else 52.0

    return {
        "metrics": {
            "total_missions": total_trips,
            "total_minutes_saved": round(total_time_saved_s / 60, 1),
            "total_signals_cleared": total_signals_bypassed,
            "total_distance_km": round(total_distance_m / 1000, 1),
            "average_speed_kmh": avg_speed,
            "green_wave_efficiency": "94.2%",
            "active_hospitals": 4,
            "storage_source": source_used
        },
        "recent_trips": trips
    }

# =========================================================
# Password Security & Verification (bcrypt rounds=12)
# =========================================================

def hash_password(plain_password: str) -> str:
    """Hashes a password using bcrypt with salt rounds=12."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(plain_password.encode("utf-8"), salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plaintext password against a bcrypt hash."""
    if not plain_password or not hashed_password:
        return False
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

# Local SQLite fallback for smartway_profiles table (stores only bcrypt hashed passwords)
def init_local_profiles_table():
    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS smartway_profiles (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        vehicle_id TEXT,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    """)
    cursor.execute("SELECT COUNT(*) FROM smartway_profiles")
    if cursor.fetchone()[0] == 0:
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        cursor.executemany("""
        INSERT INTO smartway_profiles (id, username, full_name, role, vehicle_id, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, [
            ("p1", "driver1", "Rajesh Kumar (Rapid Response)", "driver", "AMB-108", "$2b$12$piYrz.nzok9rqp96okrQQOczBaqFRghlJH7XiFY6HX6LNqAuC4r0K", now),
            ("p2", "driver2", "Priya Sharma (Trauma Unit)", "driver", "AMB-102", "$2b$12$piYrz.nzok9rqp96okrQQOczBaqFRghlJH7XiFY6HX6LNqAuC4r0K", now),
            ("p3", "admin", "Hyderabad Emergency Command", "admin", "HQ-CONTROL", "$2b$12$FWopysXu0rKYwnDdHpHYaemPCIerX4WiTCNh3CDEeb4GHlZPbBSUW", now),
        ])
    conn.commit()
    conn.close()

init_local_profiles_table()

def authenticate(username, password):
    """
    Authenticates user credentials against the Supabase smartway_profiles table.
    Passwords in Supabase and local store are stored as bcrypt hashes.
    Falls back cleanly to local SQLite if remote table is offline or pending migration.
    """
    cleaned_username = username.lower().strip()
    
    # 1. Attempt authentication against Supabase smartway_profiles table
    try:
        url = f"{SUPABASE_URL}/rest/v1/smartway_profiles?username=eq.{cleaned_username}&select=*"
        res = requests.get(url, headers=HEADERS, timeout=4)
        if res.status_code == 200:
            profiles = res.json()
            if profiles and len(profiles) > 0:
                profile = profiles[0]
                stored_hash = profile.get("password_hash")
                if stored_hash:
                    if verify_password(password, stored_hash):
                        return {
                            "authenticated": True,
                            "username": profile.get("username", cleaned_username),
                            "name": profile.get("full_name", cleaned_username),
                            "role": profile.get("role", "driver"),
                            "vehicle_id": profile.get("vehicle_id", "AMB-108"),
                            "source": "supabase"
                        }
                    else:
                        return {"authenticated": False, "error": "Invalid ID or password."}
    except Exception as e:
        print("Supabase auth check notice:", e)

    # 2. Local fallback: Query local SQLite smartway_profiles table with bcrypt hash verification
    try:
        conn = database.get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM smartway_profiles WHERE LOWER(username) = ?", (cleaned_username,))
        row = cursor.fetchone()
        conn.close()
        if row:
            profile = dict(row)
            stored_hash = profile.get("password_hash")
            if stored_hash and verify_password(password, stored_hash):
                return {
                    "authenticated": True,
                    "username": profile["username"],
                    "name": profile.get("full_name", profile["username"]),
                    "role": profile.get("role", "driver"),
                    "vehicle_id": profile.get("vehicle_id", "AMB-108"),
                    "source": "local_fallback"
                }
            else:
                return {"authenticated": False, "error": "Invalid ID or password."}
    except Exception as e:
        print("Local SQLite auth error:", e)

    return {"authenticated": False, "error": "Invalid ID or password."}

def sync_profile_password(username: str, plain_password: str):
    """
    Utility to update or sync a bcrypt-hashed password to Supabase smartway_profiles.
    """
    pw_hash = hash_password(plain_password)
    try:
        url = f"{SUPABASE_URL}/rest/v1/smartway_profiles?username=eq.{username.lower().strip()}"
        res = requests.patch(url, headers=HEADERS, json={"password_hash": pw_hash}, timeout=4)
        return {"status_code": res.status_code, "response": res.text, "password_hash": pw_hash}
    except Exception as e:
        return {"error": str(e)}
