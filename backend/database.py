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

    # Seed Comprehensive Real Hyderabad Traffic Signals (59 Major Intersections)
    real_signals = [
        # Hitec City & Madhapur Corridor
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
        ("sig_hyd_12", "Wipro Circle Junction", 17.4241, 78.3458, "RED", "Financial District"),
        ("sig_hyd_13", "Cyber Gateway Junction", 17.4475, 78.3775, "RED", "Hitec City Main Road"),
        ("sig_hyd_14", "Shilparamam Junction", 17.4530, 78.3790, "RED", "Hitec City Central"),
        ("sig_hyd_15", "HITEX Exhibition Junction", 17.4645, 78.3720, "RED", "HITEX Corridor"),
        ("sig_hyd_16", "Hitec MMTS / COD Junction", 17.4580, 78.3735, "RED", "Hitec MMTS Corridor"),
        ("sig_hyd_17", "Ayyappa Society 100ft Junction", 17.4535, 78.3885, "RED", "Madhapur North"),
        ("sig_hyd_18", "Kavuri Hills Junction", 17.4420, 78.3980, "RED", "Madhapur East"),
        ("sig_hyd_19", "Neerus Junction (Jubilee Entry)", 17.4385, 78.4045, "RED", "Jubilee Hills Road 36"),
        ("sig_hyd_20", "Peddamma Gudi Junction (Rd 36)", 17.4350, 78.4020, "RED", "Road No. 36 Corridor"),
        ("sig_hyd_21", "Cable Bridge East Ramp", 17.4362, 78.4085, "RED", "Cable Bridge Corridor"),
        ("sig_hyd_22", "Raidurg Metro Terminal Circle", 17.4410, 78.3760, "RED", "Mindspace West"),
        # Gachibowli & Financial District Corridor
        ("sig_hyd_23", "Gachibowli Flyover Junction", 17.4380, 78.3580, "RED", "Old Mumbai Highway"),
        ("sig_hyd_24", "IIIT Hyderabad Junction", 17.4435, 78.3490, "RED", "Gachibowli Tech Zone"),
        ("sig_hyd_25", "DLF Cybercity Gate Junction", 17.4480, 78.3560, "RED", "Gachibowli North"),
        ("sig_hyd_26", "Radisson Hitec City Junction", 17.4520, 78.3570, "RED", "Gachibowli Arterial"),
        ("sig_hyd_27", "Microsoft / ISB Road Junction", 17.4190, 78.3420, "RED", "Financial District"),
        ("sig_hyd_28", "Continental Hospital Circle", 17.4184, 78.3486, "RED", "Nanakramguda Corridor"),
        ("sig_hyd_29", "Waverock / TSIIC Rotary", 17.4140, 78.3420, "RED", "Financial District South"),
        ("sig_hyd_30", "Nanakramguda Rotary", 17.4200, 78.3600, "RED", "ORR Service Road"),
        ("sig_hyd_31", "Gowlidoddy Junction", 17.4210, 78.3340, "RED", "Financial District West"),
        # Kondapur, Hafeezpet & Miyapur Corridor
        ("sig_hyd_32", "Botanical Garden Junction", 17.4580, 78.3630, "RED", "Botanical Garden Road"),
        ("sig_hyd_33", "Whitefields Junction", 17.4630, 78.3610, "RED", "Kondapur Link"),
        ("sig_hyd_34", "Kondapur Masjid Banda Junction", 17.4660, 78.3540, "RED", "Kondapur Central"),
        ("sig_hyd_35", "Chirec International Junction", 17.4630, 78.3510, "RED", "Kondapur Arterial"),
        ("sig_hyd_36", "Hafeezpet Flyover Junction", 17.4810, 78.3520, "RED", "Hafeezpet Arterial"),
        ("sig_hyd_37", "Allwyn X Roads (Miyapur Link)", 17.4930, 78.3480, "RED", "Miyapur Corridor"),
        ("sig_hyd_38", "Miyapur Metro Station Junction", 17.4965, 78.3600, "RED", "Miyapur Metro Corridor"),
        # Jubilee Hills & Banjara Hills Corridor
        ("sig_hyd_39", "Road No. 10 / Cancer Hospital Junction", 17.4245, 78.4230, "RED", "Jubilee Hills South"),
        ("sig_hyd_40", "KBR Park Main Gate Junction", 17.4255, 78.4290, "RED", "Banjara-Jubilee Link"),
        ("sig_hyd_41", "Sagar Society Junction (Rd 2)", 17.4270, 78.4350, "RED", "Banjara Hills Rd 2"),
        ("sig_hyd_42", "NFCL Circle / Panjagutta", 17.4260, 78.4505, "RED", "Panjagutta Arterial"),
        ("sig_hyd_43", "Taj Krishna Circle (Rd 1)", 17.4170, 78.4480, "RED", "Banjara Hills Rd 1"),
        ("sig_hyd_44", "Care Hospital Junction (Rd 10)", 17.4190, 78.4430, "RED", "Banjara Hills Rd 10"),
        ("sig_hyd_45", "Masab Tank / Pension Office Junction", 17.4040, 78.4520, "RED", "Masab Tank Corridor"),
        # Kukatpally & Ameerpet Corridor
        ("sig_hyd_46", "JNTU X Roads Junction", 17.4980, 78.3880, "RED", "Kukatpally Highway"),
        ("sig_hyd_47", "KPHB Colony Metro Junction", 17.4920, 78.3990, "RED", "KPHB Corridor"),
        ("sig_hyd_48", "Forum Sujana Mall Junction", 17.4860, 78.3880, "RED", "KPHB Phase 9 Link"),
        ("sig_hyd_49", "Malaysian Township Circle", 17.4820, 78.3920, "RED", "KPHB Arterial"),
        ("sig_hyd_50", "Moosapet Y Junction", 17.4690, 78.4310, "RED", "Moosapet Corridor"),
        ("sig_hyd_51", "Bharat Nagar Metro Junction", 17.4620, 78.4380, "RED", "NH65 Corridor"),
        ("sig_hyd_52", "Erragadda X Roads", 17.4550, 78.4420, "RED", "NH65 Corridor"),
        ("sig_hyd_53", "SR Nagar X Roads", 17.4440, 78.4450, "RED", "Ameerpet Highway"),
        ("sig_hyd_54", "Ameerpet Metro Central Junction", 17.4370, 78.4480, "RED", "Ameerpet Metro Hub"),
        # Shaikpet & Tolichowki Corridor
        ("sig_hyd_55", "Shaikpet Flyover / Dargah Junction", 17.4120, 78.3910, "RED", "Tolichowki-Gachibowli Link"),
        ("sig_hyd_56", "Tolichowki X Roads Junction", 17.4010, 78.4110, "RED", "Tolichowki Arterial"),
        ("sig_hyd_57", "Rethi Bowli Junction", 17.3940, 78.4280, "RED", "Mehdipatnam Link"),
        ("sig_hyd_58", "Mehdipatnam Ring Road Junction", 17.3910, 78.4410, "RED", "Mehdipatnam Arterial"),
        ("sig_hyd_59", "Attapur Pillar 143 Junction", 17.3780, 78.4350, "RED", "PVNR Expressway Link")
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
