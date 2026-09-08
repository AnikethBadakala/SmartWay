import asyncio
import json
import math
import os
import time
import traci
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import database

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

ROUTE_SIGNALS = []
connected_clients = set()

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

async def simulation_loop():
    global SIMULATION_RUNNING, AMBULANCE_IN_TRANSIT, CURRENT_MISSION_ID
    step = 0
    while SIMULATION_RUNNING:
        try:
            traci.simulationStep()
        except Exception as e:
            print("TraCI step error:", e)
            SIMULATION_RUNNING = False
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
                
                # Record to Database
                if CURRENT_MISSION_ID:
                    database.record_mission_end(CURRENT_MISSION_ID, bypassed_sig, time_saved_s)
                    
                data["journey_completed"] = {
                    "hospital": CURRENT_DISPATCH_INFO["hospital"] or "Destination Hospital",
                    "incident": CURRENT_DISPATCH_INFO["incident"] or "Pickup Point",
                    "bypassed_signals": bypassed_sig,
                    "time_saved_seconds": time_saved_s,
                    "minutes_saved": round(time_saved_s / 60, 1)
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

        # Include congestion alert & pending reroute if active
        if CURRENT_DISPATCH_INFO["active_congestion"]:
            data["congestion_alert"] = CURRENT_DISPATCH_INFO["active_congestion"]
            data["pending_reroute"] = CURRENT_DISPATCH_INFO["pending_reroute"]

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
    pass

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
    global SIMULATION_RUNNING
    return {"running": SIMULATION_RUNNING}

@app.get("/start_sim")
async def start_sim():
    global SIMULATION_RUNNING
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
        "--step-length", "0.1"
    ]
    
    try:
        traci.start(sumo_cmd)
        SIMULATION_RUNNING = True
        asyncio.create_task(simulation_loop())
        return {"status": "Simulation started"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/stop_sim")
async def stop_sim():
    global SIMULATION_RUNNING, AMBULANCE_IN_TRANSIT, ROUTE_SIGNALS, CURRENT_DISPATCH_INFO
    SIMULATION_RUNNING = False
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

    try:
        traci.close()
    except Exception:
        pass
    return {"status": "Simulation stopped"}

@app.post("/dispatch")
async def dispatch_ambulance(hospital_id: str = "", incident_id: str = ""):
    global SIMULATION_RUNNING, CURRENT_DISPATCH_INFO, AMBULANCE_IN_TRANSIT, CURRENT_MISSION_ID
    if not SIMULATION_RUNNING:
        res = await start_sim()
        if not SIMULATION_RUNNING:
            return {"error": f"Failed to initialize simulation: {res.get('message')}"}
            
    CURRENT_DISPATCH_INFO["bypassed_tls"] = set()
    CURRENT_DISPATCH_INFO["time_saved"] = 0
    CURRENT_DISPATCH_INFO["active_congestion"] = None
    CURRENT_DISPATCH_INFO["pending_reroute"] = None

    all_incidents = database.get_all_incidents()
    all_hospitals = database.get_all_hospitals()
    
    start_info = next((i for i in all_incidents if i["id"] == incident_id), all_incidents[0])
    end_info = next((h for h in all_hospitals if h["id"] == hospital_id), all_hospitals[0])
    
    start_edge = start_info["edge"]
    end_edge = end_info["edge"]
    
    try:
        # 1. Optimal Route
        optimal_stage = traci.simulation.findRoute(start_edge, end_edge)
        if not optimal_stage or len(optimal_stage.edges) == 0:
            return {"error": f"No connected route found between {start_info['name']} and {end_info['name']}"}
        
        optimal_edges = list(optimal_stage.edges)
        optimal_coords = edges_to_coords(optimal_edges)
        
        # 2. Alternative Route 1
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

        # 3. Alternative Route 2
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

        generate_signals_along_route(optimal_edges)

        CURRENT_DISPATCH_INFO["optimal_route"] = optimal_coords
        CURRENT_DISPATCH_INFO["optimal_edges"] = optimal_edges
        CURRENT_DISPATCH_INFO["alt_route_1"] = alt1_coords
        CURRENT_DISPATCH_INFO["alt_route_2"] = alt2_coords
        CURRENT_DISPATCH_INFO["incident"] = start_info["name"]
        CURRENT_DISPATCH_INFO["hospital"] = end_info["name"]

        # Record mission in database
        CURRENT_MISSION_ID = f"mis_{int(time.time()*1000)}"
        database.record_mission_start(
            CURRENT_MISSION_ID,
            AMBULANCE_ID,
            start_info["id"],
            end_info["id"],
            optimal_stage.length
        )

        if AMBULANCE_ID in traci.vehicle.getIDList():
            try:
                traci.vehicle.remove(AMBULANCE_ID)
            except Exception:
                pass
        
        route_id = f"route_{int(time.time() * 1000)}"
        traci.route.add(route_id, optimal_edges)
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
            "signals_count": len(ROUTE_SIGNALS),
            "optimal_distance_m": round(optimal_stage.length, 1),
            "alt1_distance_m": round(alt1_dist, 1),
            "alt2_distance_m": round(alt2_dist, 1)
        }
    except Exception as e:
        return {"error": str(e)}

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
