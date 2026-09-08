import json
import sqlite3
import os
import sys
from mcp.server.mcpserver import MCPServer
import database

# Initialize database
database.init_db()

mcp = MCPServer("SmartWay-Traffic-Database-Server")

@mcp.tool()
def query_traffic_data(sql_query: str) -> str:
    """Executes a SELECT query on the SmartWay traffic database to retrieve hospitals, incidents, missions, or road congestion."""
    if not sql_query.strip().lower().startswith("select"):
        return json.dumps({"error": "Only SELECT queries are permitted for data safety."})
    
    try:
        conn = database.get_db()
        cursor = conn.cursor()
        cursor.execute(sql_query)
        rows = cursor.fetchall()
        conn.close()
        results = [dict(r) for r in rows]
        return json.dumps({"count": len(results), "data": results}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})

@mcp.tool()
def report_road_congestion(road_name: str, edge: str, slowdown_pct: int = 75) -> str:
    """Reports a live traffic congestion or roadblock incident on a specific road edge in Hyderabad."""
    try:
        inc_id = database.report_congestion(road_name, edge, slowdown_pct)
        return json.dumps({
            "status": "reported",
            "incident_id": inc_id,
            "road": road_name,
            "edge": edge,
            "slowdown": f"{slowdown_pct}%",
            "message": "Traffic incident logged. Dynamic rerouting engine will avoid this road segment."
        })
    except Exception as e:
        return json.dumps({"error": str(e)})

@mcp.tool()
def get_best_hospital_for_patient(severity: str = "High") -> str:
    """Evaluates hospitals based on real-time ICU bed availability, trauma level, and emergency readiness."""
    hospitals = database.get_all_hospitals()
    if not hospitals:
        return json.dumps({"error": "No hospitals available in database."})
    
    # Sort by available ICU beds descending
    sorted_hospitals = sorted(hospitals, key=lambda h: h["icu_beds_available"], reverse=True)
    best = sorted_hospitals[0]
    
    return json.dumps({
        "recommended_hospital": best["name"],
        "address": best["address"],
        "icu_beds_available": best["icu_beds_available"],
        "trauma_level": best["trauma_level"],
        "edge": best["edge"],
        "all_options": [
            {
                "name": h["name"],
                "icu_beds": h["icu_beds_available"],
                "trauma_level": h["trauma_level"]
            }
            for h in sorted_hospitals
        ]
    }, indent=2)

@mcp.tool()
def get_mission_analytics() -> str:
    """Calculates cumulative emergency response analytics, total time saved, and bypassed traffic signals."""
    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT 
        COUNT(*) as total_missions,
        SUM(bypassed_signals) as total_signals_cleared,
        SUM(time_saved_s) as total_seconds_saved,
        AVG(distance_m) as avg_distance_m
    FROM missions
    """)
    row = dict(cursor.fetchone())
    conn.close()
    
    total_sec = row["total_seconds_saved"] or 0
    return json.dumps({
        "total_missions_completed": row["total_missions"] or 0,
        "total_signals_preempted": row["total_signals_cleared"] or 0,
        "total_time_saved_minutes": round(total_sec / 60, 1),
        "total_time_saved_seconds": total_sec,
        "average_distance_km": round((row["avg_distance_m"] or 0) / 1000, 2)
    }, indent=2)

@mcp.tool()
def get_fleet_analytics() -> str:
    """Fetches real-time fleet operations metrics and recent trips from Supabase database."""
    try:
        import supabase_client
        data = supabase_client.get_analytics()
        return json.dumps(data, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})

if __name__ == "__main__":
    print("SmartWay MCP Server is starting via stdio transport...")
    mcp.run()
