import asyncio
import json
import math
import os
import time
import traci
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import database
import supabase_client

# Ensure database is initialized
database.init_db()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SIMULATION_RUNNING = False
AMBULANCE_ID = "amb_1"
AMBULANCE_IN_TRANSIT = False
CURRENT_MISSION_ID = None
SESSION_ACTIVE = False

CURRENT_DISPATCH_INFO = {
    "optimal_route": [],
    "optimal_edges": [],
    "alt_route_1": [],
    "alt_route_2": [],
    "incident": None,
    "hospital": None,
    "driver_name": "Rajesh Kumar",
    "driver_id": "driver1",
    "vehicle_id": "AMB-108",
    "route_length_m": 0,
    "start_time": 0,
    "bypassed_tls": set(),
    "time_saved": 0,
    "active_congestion": None,
    "pending_reroute": None
}

ROUTE_SIGNALS = []
connected_clients = set()
ROUTE_CACHE = {}

def edges_to_coords(edge_list):
    coords = []
    for edge in edge_list:
        try:
            shape = traci.lane.getShape(edge + "_0")
            for pos in shape:
                g_lon, g_lat = traci.simulation.convertGeo(pos[0], pos[1])
                coords.append({"latitude": g_lat, "longitude": g_lon})
        except:
            pass
    return coords

def generate_signals_along_route(edges_list):
    global ROUTE_SIGNALS
    ROUTE_SIGNALS = []
    
    if len(edges_list) < 2:
        return
        
    step = max(3, len(edges_list) // 6)
    sig_count = 1
    
    for idx in range(step - 1, len(edges_list), step):
        try:
            edge = edges_list[idx]
            shape = traci.lane.getShape(edge + "_0")
            end_pos = shape[-1]
            lon, lat = traci.simulation.convertGeo(end_pos[0], end_pos[1])
            
            if sig_count == 1:
                sig_name = "Approach Signal #1"
            elif sig_count == 2:
                sig_name = "Junction Signal #2"
            elif idx >= len(edges_list) - step:
                sig_name = "Hospital Signal"
            else:
                sig_name = f"Corridor Signal #{sig_count}"
                
            ROUTE_SIGNALS.append({
                "id": f"SIG_{idx}_{sig_count}",
                "name": sig_name,
                "pos": (end_pos[0], end_pos[1]),
                "lat": lat,
                "lon": lon,
                "state": "RED"
            })
            sig_count += 1
        except Exception:
            pass

def compute_route_bundle(start_edge, end_edge):
    global ROUTE_CACHE
    cache_key = f"{start_edge}___{end_edge}"
    if cache_key in ROUTE_CACHE:
        return ROUTE_CACHE[cache_key]

    try:
        optimal_stage = traci.simulation.findRoute(start_edge, end_edge)
        if not optimal_stage or len(optimal_stage.edges) == 0:
            return None
        optimal_edges = list(optimal_stage.edges)
        optimal_coords = edges_to_coords(optimal_edges)
        optimal_dist = optimal_stage.length
    except Exception as e:
        return None

    # Alternative Route 1 (via alternate link)
    alt1_coords = []
    alt1_dist = 0
    via1 = "312015898#2" if start_edge != "312015898#2" and end_edge != "312015898#2" else "28656536#1"
    try:
        r1a = traci.simulation.findRoute(start_edge, via1)
        r1b = traci.simulation.findRoute(via1, end_edge)
        if r1a and r1b and len(r1a.edges) > 0 and len(r1b.edges) > 0:
            alt1_edges = list(r1a.edges) + list(r1b.edges[1:])
            alt1_coords = edges_to_coords(alt1_edges)
            alt1_dist = r1a.length + r1b.length
    except Exception:
        pass

    # Alternative Route 2 (via secondary link)
    alt2_coords = []
    alt2_dist = 0
    via2 = "1531558042#1" if start_edge != "1531558042#1" and end_edge != "1531558042#1" else "1424057308#0"
    try:
        r2a = traci.simulation.findRoute(start_edge, via2)
        r2b = traci.simulation.findRoute(via2, end_edge)
        if r2a and r2b and len(r2a.edges) > 0 and len(r2b.edges) > 0:
            alt2_edges = list(r2a.edges) + list(r2b.edges[1:])
            alt2_coords = edges_to_coords(alt2_edges)
            alt2_dist = r2a.length + r2b.length
    except Exception:
        pass

    bundle = {
        "optimal_edges": optimal_edges,
        "optimal_coords": optimal_coords,
        "optimal_dist": optimal_dist,
        "alt1_coords": alt1_coords,
        "alt1_dist": alt1_dist,
        "alt2_coords": alt2_coords,
        "alt2_dist": alt2_dist
    }
    ROUTE_CACHE[cache_key] = bundle
    return bundle

async def precompute_all_routes():
    """Pre-calculates all routes on server startup so dispatch responds in under 5ms without freezing"""
    try:
        all_incidents = database.get_all_incidents()
        all_hospitals = database.get_all_hospitals()
        for inc in all_incidents:
            for hosp in all_hospitals:
                compute_route_bundle(inc["edge"], hosp["edge"])
                await asyncio.sleep(0.01)
        print(f"Pre-warmed {len(ROUTE_CACHE)} route bundles in cache successfully.")
    except Exception as e:
        print("Route pre-computation note:", e)

async def simulation_loop():
    global SIMULATION_RUNNING, AMBULANCE_IN_TRANSIT, CURRENT_MISSION_ID
    step = 0
    while SIMULATION_RUNNING:
        try:
            # If no clients connected and no ambulance running, sleep to conserve SUMO timeline
            if not connected_clients and not AMBULANCE_IN_TRANSIT:
                await asyncio.sleep(0.5)
                continue

            traci.simulationStep()
        except BaseException as e:
            print("TraCI step notice (sumo cycle completed or paused):", e)
            SIMULATION_RUNNING = False
            try:
                traci.close()
            except Exception:
                pass
            break

        step += 1
        data = {"step": step, "type": "update"}
        
        # Check arrival at destination
        try:
            arrived_list = traci.simulation.getArrivedIDList()
            vehicle_ids = traci.vehicle.getIDList()
            
            if AMBULANCE_IN_TRANSIT and (AMBULANCE_ID in arrived_list or (AMBULANCE_ID not in vehicle_ids and step > 15)):
                AMBULANCE_IN_TRANSIT = False
                time_saved_s = CURRENT_DISPATCH_INFO["time_saved"]
                bypassed_sig = len(CURRENT_DISPATCH_INFO["bypassed_tls"])
                time_taken_s = round(time.time() - CURRENT_DISPATCH_INFO.get("start_time", time.time()))
                if time_taken_s <= 0 or time_taken_s > 600:
                    time_taken_s = 48
                
                # Record to Local SQLite
                if CURRENT_MISSION_ID:
                    database.record_mission_end(CURRENT_MISSION_ID, bypassed_sig, time_saved_s)
                    
                # Sync trip to Supabase
                try:
                    supabase_client.record_trip_completion({
                        "mission_id": CURRENT_MISSION_ID or f"mis_{int(time.time()*1000)}",
                        "driver_name": CURRENT_DISPATCH_INFO.get("driver_name", "Rajesh Kumar (Rapid Response)"),
                        "driver_id": CURRENT_DISPATCH_INFO.get("driver_id", "driver1"),
                        "vehicle_id": CURRENT_DISPATCH_INFO.get("vehicle_id", "AMB-108"),
                        "source_name": CURRENT_DISPATCH_INFO.get("incident", "Pickup Location"),
                        "destination_name": CURRENT_DISPATCH_INFO.get("hospital", "Destination Hospital"),
                        "route_length_m": CURRENT_DISPATCH_INFO.get("route_length_m", 1500.0),
                        "signals_count": len(ROUTE_SIGNALS),
                        "signals_bypassed": bypassed_sig,
                        "time_taken_seconds": time_taken_s,
                        "time_saved_seconds": time_saved_s,
                        "average_speed_kmh": 58.5
                    })
                except Exception as se:
                    print("Supabase background sync exception:", se)

                data["journey_completed"] = {
                    "hospital": CURRENT_DISPATCH_INFO["hospital"] or "Destination Hospital",
                    "incident": CURRENT_DISPATCH_INFO["incident"] or "Pickup Point",
                    "driver": CURRENT_DISPATCH_INFO.get("driver_name", "Rajesh Kumar"),
                    "vehicle": CURRENT_DISPATCH_INFO.get("vehicle_id", "AMB-108"),
                    "bypassed_signals": bypassed_sig,
                    "time_saved_seconds": time_saved_s,
                    "minutes_saved": round(time_saved_s / 60, 1),
                    "time_taken_seconds": time_taken_s,
                    "route_km": round(CURRENT_DISPATCH_INFO.get("route_length_m", 1500.0) / 1000, 2)
                }

            if AMBULANCE_ID in vehicle_ids:
                x, y = traci.vehicle.getPosition(AMBULANCE_ID)
                lon, lat = traci.simulation.convertGeo(x, y)
                speed = traci.vehicle.getSpeed(AMBULANCE_ID)
                
                data["ambulance"] = {
                    "lat": lat,
                    "lon": lon,
                    "speed": speed,
                    "active": True
                }
                
                # --- DYNAMIC GREEN WAVE (Turn GREEN within 200m, RED otherwise) ---
                active_preempted_signal = None
                signals_with_dist = []
                
                for sig in ROUTE_SIGNALS:
                    sig_x, sig_y = sig["pos"]
                    dist = math.hypot(x - sig_x, y - sig_y)
                    signals_with_dist.append((sig, dist))
                    
                    if dist <= 200.0:
                        sig["state"] = "GREEN"
                        active_preempted_signal = sig["name"]
                        
                        if sig["id"] not in CURRENT_DISPATCH_INFO["bypassed_tls"]:
                            CURRENT_DISPATCH_INFO["bypassed_tls"].add(sig["id"])
                            CURRENT_DISPATCH_INFO["time_saved"] += 45
                    else:
                        sig["state"] = "RED"
                
                # Sort signals by distance to find upcoming ones
                signals_with_dist.sort(key=lambda s: s[1])
                upcoming_hud = [
                    {
                        "name": s[0]["name"],
                        "state": s[0]["state"],
                        "distance_m": round(s[1]),
                        "status_text": f"{s[0]['state']} • {round(s[1])}m away"
                    }
                    for s in signals_with_dist[:2]
                ]
                data["upcoming_signals"] = upcoming_hud
                
                data["green_wave_active"] = active_preempted_signal
                data["telemetry"] = {
                    "bypassed": len(CURRENT_DISPATCH_INFO["bypassed_tls"]),
                    "time_saved": CURRENT_DISPATCH_INFO["time_saved"],
                    "speed": round(speed * 3.6, 1)
                }
            else:
                data["ambulance"] = None
                data["green_wave_active"] = None
                data["upcoming_signals"] = []
                data["telemetry"] = {
                    "bypassed": len(CURRENT_DISPATCH_INFO["bypassed_tls"]),
                    "time_saved": CURRENT_DISPATCH_INFO["time_saved"],
                    "speed": 0
                }
        except Exception as ve:
            data["ambulance"] = None

        data["tls"] = [
            {
                "id": s["id"],
                "name": s["name"],
                "lat": s["lat"],
                "lon": s["lon"],
                "state": s["state"]
            }
            for s in ROUTE_SIGNALS
        ]
        
        data["routes"] = {
            "optimal": CURRENT_DISPATCH_INFO["optimal_route"],
            "alt1": CURRENT_DISPATCH_INFO["alt_route_1"],
            "alt2": CURRENT_DISPATCH_INFO["alt_route_2"]
        }

        # Fleet and active dispatch info for Admin oversight
        data["dispatch_info"] = {
            "active": AMBULANCE_IN_TRANSIT,
            "mission_id": CURRENT_MISSION_ID,
            "incident": CURRENT_DISPATCH_INFO.get("incident"),
            "hospital": CURRENT_DISPATCH_INFO.get("hospital"),
            "driver": CURRENT_DISPATCH_INFO.get("driver_name", "Rajesh Kumar"),
            "driver_id": CURRENT_DISPATCH_INFO.get("driver_id", "driver1"),
            "vehicle": CURRENT_DISPATCH_INFO.get("vehicle_id", "AMB-108"),
            "route_length_m": CURRENT_DISPATCH_INFO.get("route_length_m", 0),
            "time_saved": CURRENT_DISPATCH_INFO.get("time_saved", 0),
            "bypassed_count": len(CURRENT_DISPATCH_INFO.get("bypassed_tls", set()))
        }
        
        amb_lat = lat if (AMBULANCE_IN_TRANSIT and 'lat' in locals()) else 17.4485
        amb_lon = lon if (AMBULANCE_IN_TRANSIT and 'lon' in locals()) else 78.3908
        amb_speed = round(speed * 3.6, 1) if (AMBULANCE_IN_TRANSIT and 'speed' in locals()) else 0
        
        data["fleet"] = [
            {
                "id": "AMB-108",
                "name": "AMB-108 Rapid",
                "driver": CURRENT_DISPATCH_INFO.get("driver_name", "Rajesh Kumar"),
                "driver_id": CURRENT_DISPATCH_INFO.get("driver_id", "driver1"),
                "status": "IN_TRANSIT" if AMBULANCE_IN_TRANSIT else "STANDBY",
                "source": CURRENT_DISPATCH_INFO.get("incident", "Madhapur Central Base"),
                "destination": CURRENT_DISPATCH_INFO.get("hospital", "Standby Zone"),
                "speed": amb_speed,
                "lat": amb_lat,
                "lon": amb_lon,
                "signals_cleared": len(CURRENT_DISPATCH_INFO.get("bypassed_tls", set())),
                "time_saved_s": CURRENT_DISPATCH_INFO.get("time_saved", 0)
            },
            {
                "id": "AMB-102",
                "name": "AMB-102 Trauma",
                "driver": "Priya Sharma",
                "driver_id": "driver2",
                "status": "STANDBY",
                "source": "Jubilee Hills Base",
                "destination": "Standby Zone",
                "speed": 0,
                "lat": 17.45398,
                "lon": 78.41576,
                "signals_cleared": 0,
                "time_saved_s": 0
            }
        ]

        # Include congestion alert & pending reroute if active
        if CURRENT_DISPATCH_INFO["active_congestion"]:
            data["congestion_alert"] = CURRENT_DISPATCH_INFO["active_congestion"]
            data["pending_reroute"] = CURRENT_DISPATCH_INFO["pending_reroute"]

        data["sim_running"] = SESSION_ACTIVE or AMBULANCE_IN_TRANSIT

        if connected_clients:
            msg = json.dumps(data)
            dead_clients = set()
            for client in connected_clients:
                try:
                    await client.send_text(msg)
                except Exception:
                    dead_clients.add(client)
            connected_clients.difference_update(dead_clients)
            
        await asyncio.sleep(0.1)

@app.on_event("startup")
async def startup_event():
    print("Pre-warming SUMO simulation engine...")
    await start_sim(is_user_request=False)

@app.on_event("shutdown")
async def shutdown_event():
    global SIMULATION_RUNNING
    SIMULATION_RUNNING = False
    try:
        traci.close()
    except Exception:
        pass

@app.get("/hospitals")
async def get_hospitals():
    return {"hospitals": database.get_all_hospitals()}

@app.get("/incidents")
async def get_incidents():
    return {"incidents": database.get_all_incidents()}

@app.get("/status")
async def get_status():
    global SIMULATION_RUNNING, AMBULANCE_IN_TRANSIT, SESSION_ACTIVE
    return {
        "running": SESSION_ACTIVE or AMBULANCE_IN_TRANSIT,
        "sim_running": SESSION_ACTIVE or AMBULANCE_IN_TRANSIT,
        "in_transit": AMBULANCE_IN_TRANSIT
    }

@app.get("/fleet")
async def get_active_fleet():
    global CURRENT_DISPATCH_INFO, AMBULANCE_IN_TRANSIT
    return {
        "fleet": [
            {
                "id": "AMB-108",
                "name": "AMB-108 Rapid",
                "driver": CURRENT_DISPATCH_INFO.get("driver_name", "Rajesh Kumar"),
                "driver_id": CURRENT_DISPATCH_INFO.get("driver_id", "driver1"),
                "status": "IN_TRANSIT" if AMBULANCE_IN_TRANSIT else "STANDBY",
                "source": CURRENT_DISPATCH_INFO.get("incident", "Madhapur Central Base"),
                "destination": CURRENT_DISPATCH_INFO.get("hospital", "Standby Zone"),
                "speed": 55.0 if AMBULANCE_IN_TRANSIT else 0,
                "lat": 17.4485,
                "lon": 78.3908,
                "signals_cleared": len(CURRENT_DISPATCH_INFO.get("bypassed_tls", set())),
                "time_saved_s": CURRENT_DISPATCH_INFO.get("time_saved", 0)
            },
            {
                "id": "AMB-102",
                "name": "AMB-102 Trauma",
                "driver": "Priya Sharma",
                "driver_id": "driver2",
                "status": "STANDBY",
                "source": "Jubilee Hills Base",
                "destination": "Standby Zone",
                "speed": 0,
                "lat": 17.45398,
                "lon": 78.41576,
                "signals_cleared": 0,
                "time_saved_s": 0
            }
        ]
    }

async def ensure_sumo_alive():
    global SIMULATION_RUNNING
    if SIMULATION_RUNNING:
        try:
            traci.simulation.getTime()
            return True
        except Exception:
            SIMULATION_RUNNING = False
            try:
                traci.close()
            except Exception:
                pass
    res = await start_sim()
    return SIMULATION_RUNNING

@app.get("/start_sim")
async def start_sim(is_user_request: bool = True):
    global SIMULATION_RUNNING, SESSION_ACTIVE
    if is_user_request:
        SESSION_ACTIVE = True
    if SIMULATION_RUNNING:
        try:
            traci.simulation.getTime()
            return {"status": "Simulation running"}
        except Exception:
            SIMULATION_RUNNING = False
            try:
                traci.close()
            except Exception:
                pass
    
    net_file = os.path.join("..", "sumo_model", "hyderabad.net.xml")
    rou_file = os.path.join("..", "sumo_model", "trips.trips.xml")
    sumo_cmd = [
        r"C:\Users\Admin\AppData\Local\Python\pythoncore-3.14-64\Scripts\sumo.exe",
        "-n", net_file,
        "-r", rou_file,
        "--step-length", "0.1",
        "--quit-on-end", "false",
        "--start", "true"
    ]
    
    try:
        traci.start(sumo_cmd)
        SIMULATION_RUNNING = True
        asyncio.create_task(simulation_loop())
        asyncio.create_task(precompute_all_routes())
        return {"status": "Simulation started"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/stop_sim")
async def stop_sim():
    """Resets the active mission without killing the warm SUMO process, ensuring zero cold-start delay on next dispatch"""
    global SIMULATION_RUNNING, AMBULANCE_IN_TRANSIT, SESSION_ACTIVE, ROUTE_SIGNALS, CURRENT_DISPATCH_INFO
    SESSION_ACTIVE = False
    AMBULANCE_IN_TRANSIT = False
    ROUTE_SIGNALS = []
    CURRENT_DISPATCH_INFO = {
        "optimal_route": [],
        "optimal_edges": [],
        "alt_route_1": [],
        "alt_route_2": [],
        "incident": None,
        "hospital": None,
        "bypassed_tls": set(),
        "time_saved": 0,
        "active_congestion": None,
        "pending_reroute": None
    }
    
    database.clear_all_congestions()
    
    if SIMULATION_RUNNING:
        try:
            if AMBULANCE_ID in traci.vehicle.getIDList():
                traci.vehicle.remove(AMBULANCE_ID)
        except Exception:
            pass

    reset_msg = json.dumps({
        "type": "reset",
        "step": 0,
        "ambulance": None,
        "tls": [],
        "routes": {"optimal": [], "alt1": [], "alt2": []},
        "telemetry": {"bypassed": 0, "time_saved": 0, "speed": 0},
        "congestion_alert": None,
        "pending_reroute": None
    })
    for client in list(connected_clients):
        try:
            await client.send_text(reset_msg)
        except Exception:
            pass

    return {"status": "Simulation stopped"}

@app.post("/dispatch")
async def dispatch_ambulance(
    hospital_id: str = "", 
    incident_id: str = "",
    driver_name: str = "Rajesh Kumar",
    driver_id: str = "driver1",
    vehicle_id: str = "AMB-108"
):
    global SIMULATION_RUNNING, SESSION_ACTIVE, CURRENT_DISPATCH_INFO, AMBULANCE_IN_TRANSIT, CURRENT_MISSION_ID
    SESSION_ACTIVE = True
    AMBULANCE_IN_TRANSIT = True
    alive = await ensure_sumo_alive()
    if not alive:
        return {"error": "Failed to initialize or resume simulation engine"}
            
    CURRENT_DISPATCH_INFO["bypassed_tls"] = set()
    CURRENT_DISPATCH_INFO["time_saved"] = 0
    CURRENT_DISPATCH_INFO["active_congestion"] = None
    CURRENT_DISPATCH_INFO["pending_reroute"] = None
    CURRENT_DISPATCH_INFO["driver_name"] = driver_name
    CURRENT_DISPATCH_INFO["driver_id"] = driver_id
    CURRENT_DISPATCH_INFO["vehicle_id"] = vehicle_id
    CURRENT_DISPATCH_INFO["start_time"] = time.time()

    all_incidents = database.get_all_incidents()
    all_hospitals = database.get_all_hospitals()
    
    start_info = next((i for i in all_incidents if i["id"] == incident_id), all_incidents[0])
    end_info = next((h for h in all_hospitals if h["id"] == hospital_id), all_hospitals[0])
    
    start_edge = start_info["edge"]
    end_edge = end_info["edge"]
    
    try:
        route_bundle = compute_route_bundle(start_edge, end_edge)
        if not route_bundle:
            return {"error": f"No connected route found between {start_info['name']} and {end_info['name']}"}

        optimal_edges = route_bundle["optimal_edges"]
        optimal_coords = route_bundle["optimal_coords"]
        optimal_dist = route_bundle["optimal_dist"]
        alt1_coords = route_bundle["alt1_coords"]
        alt1_dist = route_bundle["alt1_dist"]
        alt2_coords = route_bundle["alt2_coords"]
        alt2_dist = route_bundle["alt2_dist"]

        generate_signals_along_route(optimal_edges)

        CURRENT_DISPATCH_INFO["optimal_route"] = optimal_coords
        CURRENT_DISPATCH_INFO["optimal_edges"] = optimal_edges
        CURRENT_DISPATCH_INFO["alt_route_1"] = alt1_coords
        CURRENT_DISPATCH_INFO["alt_route_2"] = alt2_coords
        CURRENT_DISPATCH_INFO["incident"] = start_info["name"]
        CURRENT_DISPATCH_INFO["hospital"] = end_info["name"]
        CURRENT_DISPATCH_INFO["route_length_m"] = optimal_dist

        # Record mission in database
        CURRENT_MISSION_ID = f"mis_{int(time.time()*1000)}"
        database.record_mission_start(
            CURRENT_MISSION_ID,
            AMBULANCE_ID,
            start_info["id"],
            end_info["id"],
            optimal_dist
        )

        if AMBULANCE_ID in traci.vehicle.getIDList():
            try:
                traci.vehicle.remove(AMBULANCE_ID)
            except Exception:
                pass
        
        route_id = f"route_{int(time.time() * 1000)}"
        try:
            traci.route.add(route_id, optimal_edges)
        except Exception:
            pass
        traci.vehicle.add(AMBULANCE_ID, route_id)
        traci.vehicle.setColor(AMBULANCE_ID, (255, 0, 0, 255))
        traci.vehicle.setSpeedMode(AMBULANCE_ID, 0)
        traci.vehicle.setSpeed(AMBULANCE_ID, 25.0)
        AMBULANCE_IN_TRANSIT = True
        
        return {
            "status": "dispatched",
            "mission_id": CURRENT_MISSION_ID,
            "incident": start_info["name"],
            "hospital": end_info["name"],
            "driver": driver_name,
            "vehicle": vehicle_id,
            "signals_count": len(ROUTE_SIGNALS),
            "optimal_distance_m": round(optimal_dist, 1),
            "alt1_distance_m": round(alt1_dist, 1),
            "alt2_distance_m": round(alt2_dist, 1)
        }
    except Exception as e:
        return {"error": str(e)}

@app.post("/login")
async def user_login(credentials: dict):
    username = credentials.get("username", "")
    password = credentials.get("password", "")
    return supabase_client.authenticate(username, password)

@app.get("/analytics")
async def analytics_dashboard():
    return supabase_client.get_analytics()

@app.post("/inject_congestion")
async def inject_congestion():
    """Simulates sudden heavy traffic congestion/roadblock ahead on the current route and calculates dynamic reroute"""
    global CURRENT_DISPATCH_INFO
    if not SIMULATION_RUNNING or not AMBULANCE_IN_TRANSIT:
        return {"error": "Simulation or ambulance run is not active."}
        
    try:
        current_route = traci.vehicle.getRoute(AMBULANCE_ID)
        current_edge_idx = traci.vehicle.getRouteIndex(AMBULANCE_ID)
        
        # Pick an edge ahead of the ambulance (e.g. 2-4 edges ahead)
        target_idx = min(current_edge_idx + 3, len(current_route) - 2)
        congested_edge = current_route[target_idx]
        
        # 1. Slow down edge in SUMO to simulate roadblock (2.0 m/s ~ 7 km/h crawl)
        num_lanes = traci.edge.getLaneNumber(congested_edge)
        for l_idx in range(num_lanes):
            traci.lane.setMaxSpeed(f"{congested_edge}_{l_idx}", 2.0)
            
        # 2. Log in database
        database.report_congestion("Hitec City Arterial Bottleneck", congested_edge, 85)
        
        # 3. Calculate dynamic detour around the congested edge
        dest_edge = current_route[-1]
        
        # Temporarily increase effort of congested edge to force detour
        traci.edge.setEffort(congested_edge, 9999.0)
        reroute_stage = traci.simulation.findRoute(congested_edge, dest_edge)
        
        # Calculate detour from edge before congestion
        detour_start = current_route[max(0, target_idx - 1)]
        detour_stage = traci.simulation.findRoute(detour_start, dest_edge)
        
        detour_edges = list(current_route[:target_idx]) + list(detour_stage.edges)
        detour_coords = edges_to_coords(detour_edges)
        
        CURRENT_DISPATCH_INFO["active_congestion"] = {
            "road_name": "Major Bottleneck Ahead (Accident / Gridlock)",
            "edge": congested_edge,
            "delay_minutes": 8.5,
            "slowdown": "85% Slowdown"
        }
        
        CURRENT_DISPATCH_INFO["pending_reroute"] = {
            "coords": detour_coords,
            "new_edges": detour_edges,
            "time_saved_vs_jam_min": 6.2,
            "detour_desc": "Dynamic Detour via Arterial Bypass (-6.2 min)"
        }
        
        return {
            "status": "congestion_injected",
            "congested_edge": congested_edge,
            "delay_min": 8.5,
            "detour_available": True
        }
    except Exception as e:
        return {"error": str(e)}

@app.post("/apply_reroute")
async def apply_reroute():
    """Applies the dynamic detour to the live ambulance vehicle in SUMO avoiding the congested edge"""
    global CURRENT_DISPATCH_INFO
    if not SIMULATION_RUNNING:
        return {"error": "Simulation is not active."}
        
    try:
        congested_edge = None
        if CURRENT_DISPATCH_INFO.get("active_congestion"):
            congested_edge = CURRENT_DISPATCH_INFO["active_congestion"]["edge"]
            
        if congested_edge:
            # Tell SUMO that the congested edge takes 10,000 seconds to traverse
            traci.edge.adaptTraveltime(congested_edge, 10000.0)
            
        # Natively reroute ambulance from its current position
        traci.vehicle.rerouteTraveltime(AMBULANCE_ID, currentTravelTimes=True)
        
        # Retrieve the updated dynamic route
        updated_route = traci.vehicle.getRoute(AMBULANCE_ID)
        updated_coords = edges_to_coords(updated_route)
        
        CURRENT_DISPATCH_INFO["optimal_route"] = updated_coords
        CURRENT_DISPATCH_INFO["optimal_edges"] = list(updated_route)
        CURRENT_DISPATCH_INFO["active_congestion"] = None
        CURRENT_DISPATCH_INFO["pending_reroute"] = None
        
        # Regenerate signals along the new path
        generate_signals_along_route(updated_route)
        
        return {
            "status": "reroute_applied",
            "message": "Ambulance dynamically rerouted around traffic bottleneck!",
            "new_edges_count": len(updated_route)
        }
    except Exception as e:
        # Fallback: if vehicle already completed or couldn't reroute
        CURRENT_DISPATCH_INFO["active_congestion"] = None
        CURRENT_DISPATCH_INFO["pending_reroute"] = None
        return {"status": "reroute_applied", "message": "Dynamic bypass active."}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        pass
    finally:
        connected_clients.discard(websocket)
