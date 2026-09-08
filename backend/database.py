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

    # 5. Real Hyderabad Traffic Signals Table (for Real Movement Mode)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS hyderabad_signals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        state TEXT DEFAULT 'RED',
        preempted_at REAL,
        corridor TEXT
    )
    """)

    # Seed / Upsert Real Hyderabad Hospitals
    real_hospitals = [
        ("h1", "Apollo Hospitals, Jubilee Hills", "Road No. 72, Film Nagar, Jubilee Hills", "277794201#1", 17.4156, 78.4124, 18, "Level 1 Trauma"),
        ("h2", "Medicover Hospital, Hitec City", "Behind Cyber Towers, Madhapur", "313351521#1", 17.4474, 78.3762, 12, "Level 2 Trauma"),
        ("h3", "KIMS Hospital, Kondapur", "Hitec City - Kondapur Main Road", "113164523#0", 17.4725, 78.3582, 15, "Level 1 Trauma"),
        ("h4", "Care Hospitals, Banjara Hills", "Road No. 1, Prem Nagar, Banjara Hills", "419423735#2", 17.4168, 78.4482, 9, "Level 2 Trauma"),
        ("h5", "AIG Hospitals, Gachibowli", "Mindspace Road, Gachibowli", "312015898#2", 17.4422, 78.3615, 22, "Level 1 Comprehensive Trauma"),
        ("h6", "Continental Hospitals, Financial District", "IT Park, Nanakramguda, Gachibowli", "28656536#1", 17.4184, 78.3486, 16, "Level 1 Trauma"),
        ("h7", "Yashoda Hospitals, Hitec City", "Opp. Mindspace, Hitec City Main Road", "1531558042#1", 17.4485, 78.3842, 20, "Level 1 Super Specialty")
    ]
    for hosp in real_hospitals:
        cursor.execute("""
            INSERT INTO hospitals (id, name, address, edge, lat, lon, icu_beds_available, trauma_level, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                address=excluded.address,
                lat=excluded.lat,
                lon=excluded.lon,
                icu_beds_available=excluded.icu_beds_available,
                trauma_level=excluded.trauma_level
        """, hosp)

    # Seed Initial Incidents if empty
    cursor.execute("SELECT COUNT(*) FROM incidents")
    if cursor.fetchone()[0] == 0:
        incidents = [
            ("i1", "Cyber Towers Junction", "Hitec City Main Road", "292385861#0", 17.4504, 78.3808, "High"),
            ("i2", "Inorbit Mall Road", "Durgam Cheruvu Link, Madhapur", "312015898#2", 17.4398, 78.3922, "Medium"),
            ("i3", "Jubilee Hills Checkpost", "Road No. 36, Jubilee Hills", "1531558042#1", 17.4328, 78.4116, "High"),
            ("i4", "Durgam Cheruvu Bridge", "Cable Stayed Bridge, Madhapur", "28656536#1", 17.4362, 78.4061, "Critical"),
            ("i5", "Madhapur Metro Station", "Ayyappa Society Main Road", "1424057308#0", 17.4485, 78.3908, "Medium")
        ]
        cursor.executemany("INSERT INTO incidents VALUES (?, ?, ?, ?, ?, ?, ?)", incidents)

    # Seed Real Hyderabad Traffic Signals
    real_signals = [
        ("sig_hyd_1", "Cyber Towers Junction", 17.4504, 78.3808, "RED", "Hitec City Corridor"),
        ("sig_hyd_2", "Mindspace Circle Junction", 17.4429, 78.3792, "RED", "Mindspace Corridor"),
        ("sig_hyd_3", "Bio-Diversity Park Junction", 17.4326, 78.3697, "RED", "Gachibowli Arterial"),
        ("sig_hyd_4", "Gachibowli 'T' Junction", 17.4401, 78.3489, "RED", "Outer Ring Road Link"),
        ("sig_hyd_5", "Jubilee Hills Checkpost", 17.4328, 78.4116, "RED", "Road No. 36 Corridor"),
        ("sig_hyd_6", "Road No. 45 / Durgam Link", 17.4362, 78.4061, "RED", "Cable Bridge Corridor"),
        ("sig_hyd_7", "Madhapur Police Station Junction", 17.4485, 78.3908, "RED", "Madhapur Arterial"),
        ("sig_hyd_8", "Kothaguda Junction", 17.4608, 78.3639, "RED", "Botanical Garden Road"),
        ("sig_hyd_9", "Kondapur RTO Junction", 17.4695, 78.3582, "RED", "Kondapur Central"),
        ("sig_hyd_10", "Inorbit Mall Rotary", 17.4398, 78.3922, "RED", "Durgam Cheruvu West"),
        ("sig_hyd_11", "IKEA Rotary Junction", 17.4375, 78.3745, "RED", "Hitec City Phase 2"),
        ("sig_hyd_12", "Wipro Circle Junction", 17.4241, 78.3458, "RED", "Financial District")
    ]
    for sig in real_signals:
        cursor.execute("""
            INSERT INTO hyderabad_signals (id, name, lat, lon, state, corridor)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                lat=excluded.lat,
                lon=excluded.lon,
                corridor=excluded.corridor
        """, sig)

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

def get_hyderabad_signals():
    conn = get_db()
    rows = conn.execute("SELECT * FROM hyderabad_signals").fetchall()
    conn.close()
    return [dict(r) for r in rows]

def update_signal_state(signal_id, state):
    conn = get_db()
    preempted_at = time.time() if state == "GREEN" else None
    conn.execute(
        "UPDATE hyderabad_signals SET state=?, preempted_at=? WHERE id=?",
        (state, preempted_at, signal_id)
    )
    conn.commit()
    conn.close()

def reset_all_signals():
    conn = get_db()
    conn.execute("UPDATE hyderabad_signals SET state='RED', preempted_at=NULL")
    conn.commit()
    conn.close()

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
