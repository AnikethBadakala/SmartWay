import sqlite3
import os
import json
import time

DB_PATH = os.path.join(os.path.dirname(__file__), "smartway.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # 1. Hospitals Table (with ICU capacity & trauma level)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS hospitals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        edge TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        icu_beds_available INTEGER NOT NULL,
        trauma_level TEXT NOT NULL,
        status TEXT DEFAULT 'OPEN'
    )
    """)

    # 2. Incidents Table (Pickup points)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        edge TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        severity TEXT NOT NULL
    )
    """)

    # 3. Emergency Missions Table (Telemetry & Analytics)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        ambulance_id TEXT NOT NULL,
        incident_id TEXT NOT NULL,
        hospital_id TEXT NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL,
        distance_m REAL NOT NULL,
        bypassed_signals INTEGER DEFAULT 0,
        time_saved_s REAL DEFAULT 0,
        status TEXT DEFAULT 'IN_TRANSIT'
    )
    """)

    # 4. Traffic Incidents Table (Real-time Congestion & Roadblocks)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS traffic_incidents (
        id TEXT PRIMARY KEY,
        road_name TEXT NOT NULL,
        edge TEXT NOT NULL,
        congestion_level TEXT NOT NULL,
        slowdown_pct INTEGER NOT NULL,
        active INTEGER DEFAULT 1,
        reported_at REAL NOT NULL
    )
    """)

    # Seed Initial Hospitals if empty
    cursor.execute("SELECT COUNT(*) FROM hospitals")
    if cursor.fetchone()[0] == 0:
        hospitals = [
            ("h1", "Apollo Hospitals, Jubilee Hills", "Road No. 72, Jubilee Hills", "277794201#1", 17.44732, 78.40735, 14, "Level 1 Trauma"),
            ("h2", "Medicover Hospital, Hitec City", "Opp. Cyber Towers, Madhapur", "313351521#1", 17.45145, 78.39616, 8, "Level 2 Trauma"),
            ("h3", "KIMS Hospital, Kondapur", "Hitec City - Kondapur Road", "113164523#0", 17.45150, 78.39668, 12, "Level 1 Trauma"),
            ("h4", "Care Hospitals, Banjara Link", "Road No. 1, Jubilee Hills", "419423735#2", 17.45400, 78.41839, 6, "Level 2 Trauma")
        ]
        cursor.executemany("INSERT INTO hospitals VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')", hospitals)

    # Seed Initial Incidents if empty
    cursor.execute("SELECT COUNT(*) FROM incidents")
    if cursor.fetchone()[0] == 0:
        incidents = [
            ("i1", "Cyber Towers Junction", "Hitec City Main Road", "292385861#0", 17.45394, 78.41173, "High"),
            ("i2", "Inorbit Mall Road", "Durgam Cheruvu Link, Madhapur", "312015898#2", 17.44348, 78.39361, "Medium"),
            ("i3", "Jubilee Hills Checkpost", "Road No. 36, Jubilee Hills", "1531558042#1", 17.45398, 78.41576, "High"),
            ("i4", "Durgam Cheruvu Bridge", "Cable Stayed Bridge, Madhapur", "28656536#1", 17.43397, 78.40020, "Critical"),
            ("i5", "Madhapur Metro Station", "Ayyappa Society Main Road", "1424057308#0", 17.45342, 78.41408, "Medium")
        ]
        cursor.executemany("INSERT INTO incidents VALUES (?, ?, ?, ?, ?, ?, ?)", incidents)

    conn.commit()
    conn.close()

def get_all_hospitals():
    conn = get_db()
    rows = conn.execute("SELECT * FROM hospitals WHERE status='OPEN'").fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_all_incidents():
    conn = get_db()
    rows = conn.execute("SELECT * FROM incidents").fetchall()
    conn.close()
    return [dict(r) for r in rows]

def report_congestion(road_name, edge, slowdown_pct=75):
    conn = get_db()
    inc_id = f"cong_{int(time.time()*1000)}"
    conn.execute(
        "INSERT INTO traffic_incidents VALUES (?, ?, ?, 'HEAVY_CONGESTION', ?, 1, ?)",
        (inc_id, road_name, edge, slowdown_pct, time.time())
    )
    conn.commit()
    conn.close()
    return inc_id

def get_active_congestions():
    conn = get_db()
    rows = conn.execute("SELECT * FROM traffic_incidents WHERE active=1").fetchall()
    conn.close()
    return [dict(r) for r in rows]

def clear_all_congestions():
    conn = get_db()
    conn.execute("UPDATE traffic_incidents SET active=0")
    conn.commit()
    conn.close()

def record_mission_start(mission_id, amb_id, inc_id, hosp_id, dist_m):
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO missions VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 0, 'IN_TRANSIT')",
        (mission_id, amb_id, inc_id, hosp_id, time.time(), dist_m)
    )
    conn.commit()
    conn.close()

def record_mission_end(mission_id, bypassed_count, time_saved_s):
    conn = get_db()
    conn.execute(
        "UPDATE missions SET end_time=?, bypassed_signals=?, time_saved_s=?, status='COMPLETED' WHERE id=?",
        (time.time(), bypassed_count, time_saved_s, mission_id)
    )
    conn.commit()
    conn.close()

# Run initialization
if __name__ == "__main__":
    init_db()
    print("Database initialized successfully at:", DB_PATH)
