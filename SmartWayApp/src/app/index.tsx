import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  Platform,
  Modal,
  FlatList,
  StatusBar,
  ActivityIndicator,
  TextInput,
  ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';

const RENDER_CLOUD_HOST = 'smartway-backend-ir79.onrender.com';

// Detect local host IP from Expo Go connection if needed
const getLocalBackendHost = () => {
  const hostUri = Constants.expoConfig?.hostUri || Constants.manifest2?.extra?.expoGo?.debuggerHost;
  if (hostUri) {
    return hostUri.split(':')[0];
  }
  return '192.168.1.12';
};

// Default to 24/7 Render Cloud backend for real-world driving across Hyderabad
const DEFAULT_HOST = RENDER_CLOUD_HOST;

// Helper: Haversine distance in kilometers
function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Helper: Real-world road routing via OpenStreetMap / OSRM API across Hyderabad
async function fetchOSRMRoute(origin: { lat: number; lon: number }, dest: { lat: number; lon: number }) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.routes && json.routes.length > 0) {
      const route = json.routes[0];
      const coords = route.geometry.coordinates.map((pt: [number, number]) => ({
        latitude: pt[1],
        longitude: pt[0],
      }));
      return {
        coords,
        distance_m: route.distance,
        duration_s: route.duration,
      };
    }
  } catch (e) {
    console.log("OSRM routing notice:", e);
  }
  return null;
}

// Helper: Voice audio announcement for driver hands-free safety
const speakAlert = (text: string) => {
  try {
    Speech.stop();
    Speech.speak(text, { language: 'en-IN', rate: 1.0 });
  } catch (e) {}
};

const DEFAULT_INCIDENTS = [
  {
    id: "i1",
    name: "Cyber Towers Junction",
    address: "Hitec City Main Road, Madhapur",
    lat: 17.4504,
    lon: 78.3808
  },
  {
    id: "i2",
    name: "Inorbit Mall Road",
    address: "Durgam Cheruvu Link Road, Madhapur",
    lat: 17.4398,
    lon: 78.3922
  },
  {
    id: "i3",
    name: "Jubilee Hills Checkpost",
    address: "Road No. 36, Jubilee Hills",
    lat: 17.4328,
    lon: 78.4116
  },
  {
    id: "i4",
    name: "Durgam Cheruvu Cable Bridge",
    address: "Cable Stayed Bridge, Madhapur",
    lat: 17.4362,
    lon: 78.4061
  },
  {
    id: "i5",
    name: "Madhapur Metro Station",
    address: "Ayyappa Society Main Road",
    lat: 17.4485,
    lon: 78.3908
  },
  {
    id: "i6",
    name: "Bio-Diversity Park Junction",
    address: "Old Mumbai Highway, Gachibowli",
    lat: 17.4326,
    lon: 78.3697
  }
];

const DEFAULT_HOSPITALS = [
  {
    id: "h1",
    name: "Apollo Hospitals, Jubilee Hills",
    address: "Road No. 72, Film Nagar, Jubilee Hills",
    lat: 17.4156,
    lon: 78.4124,
    icu_beds_available: 18,
    trauma_level: "Level 1 Trauma"
  },
  {
    id: "h2",
    name: "Medicover Hospital, Hitec City",
    address: "Behind Cyber Towers, Madhapur",
    lat: 17.4474,
    lon: 78.3762,
    icu_beds_available: 12,
    trauma_level: "Level 2 Trauma"
  },
  {
    id: "h3",
    name: "KIMS Hospital, Kondapur",
    address: "Hitec City - Kondapur Main Road",
    lat: 17.4725,
    lon: 78.3582,
    icu_beds_available: 15,
    trauma_level: "Level 1 Trauma"
  },
  {
    id: "h4",
    name: "Care Hospitals, Banjara Hills",
    address: "Road No. 1, Prem Nagar, Banjara Hills",
    lat: 17.4168,
    lon: 78.4482,
    icu_beds_available: 9,
    trauma_level: "Level 2 Trauma"
  },
  {
    id: "h5",
    name: "AIG Hospitals, Gachibowli",
    address: "Mindspace Road, Gachibowli",
    lat: 17.4422,
    lon: 78.3615,
    icu_beds_available: 22,
    trauma_level: "Level 1 Comprehensive Trauma"
  },
  {
    id: "h6",
    name: "Continental Hospitals, Financial District",
    address: "IT Park, Nanakramguda, Gachibowli",
    lat: 17.4184,
    lon: 78.3486,
    icu_beds_available: 16,
    trauma_level: "Level 1 Trauma"
  },
  {
    id: "h7",
    name: "Yashoda Hospitals, Hitec City",
    address: "Opp. Mindspace, Hitec City Main Road",
    lat: 17.4485,
    lon: 78.3842,
    icu_beds_available: 20,
    trauma_level: "Level 1 Super Specialty"
  }
];

export default function HomeScreen() {
  const [backendHost, setBackendHost] = useState<string>(DEFAULT_HOST);
  const [hostModalVisible, setHostModalVisible] = useState<boolean>(false);
  const [hostInput, setHostInput] = useState<string>(DEFAULT_HOST);

  const API_URL = useMemo(() => {
    const clean = backendHost.trim();
    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      return clean.replace(/\/+$/, '');
    }
    if (clean.includes('onrender.com') || clean.includes('.com') || clean.includes('.app') || clean.includes('.org') || clean.includes('.dev')) {
      return `https://${clean.replace(/\/+$/, '')}`;
    }
    return `http://${clean}:8000`;
  }, [backendHost]);

  const WS_URL = useMemo(() => {
    const clean = backendHost.trim();
    if (clean.startsWith('https://')) {
      return `wss://${clean.replace('https://', '').replace(/\/+$/, '')}/ws`;
    }
    if (clean.startsWith('http://')) {
      return `ws://${clean.replace('http://', '').replace(/\/+$/, '')}/ws`;
    }
    if (clean.includes('onrender.com') || clean.includes('.com') || clean.includes('.app') || clean.includes('.org') || clean.includes('.dev')) {
      return `wss://${clean.replace(/\/+$/, '')}/ws`;
    }
    return `ws://${clean}:8000/ws`;
  }, [backendHost]);

  // Operational Mode: Real Driver (Live GPS on iOS in Hyderabad) vs. Simulation (SUMO)
  const [appMode, setAppMode] = useState<'real_driver' | 'simulation'>('real_driver');
  const [deviceLocation, setDeviceLocation] = useState<Location.LocationObject | null>(null);
  const [hasLocationPermission, setHasLocationPermission] = useState<boolean>(false);
  const [lastSpokenSignal, setLastSpokenSignal] = useState<string | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<string>(`Connecting (${backendHost})...`);
  const [isSimRunning, setIsSimRunning] = useState<boolean>(false);
  const [ambulance, setAmbulance] = useState<any>(null);

  // Candidate routes
  const [optimalRoute, setOptimalRoute] = useState<any[]>([]);
  const [altRoute1, setAltRoute1] = useState<any[]>([]);
  const [altRoute2, setAltRoute2] = useState<any[]>([]);
  const [routeStats, setRouteStats] = useState<any>(null);

  // Traffic signals & Upcoming Signal HUD
  const [tlsList, setTlsList] = useState<any[]>([]);
  const [upcomingSignals, setUpcomingSignals] = useState<any[]>([]);
  const [greenWaveActive, setGreenWaveActive] = useState<string | null>(null);

  // Dynamic Congestion & Reroute states
  const [congestionAlert, setCongestionAlert] = useState<any>(null);
  const [pendingReroute, setPendingReroute] = useState<any>(null);

  // Selection states
  const [incidents, setIncidents] = useState<any[]>(DEFAULT_INCIDENTS);
  const [hospitals, setHospitals] = useState<any[]>(DEFAULT_HOSPITALS);
  const [selectedIncident, setSelectedIncident] = useState<any>(null);
  const [selectedHospital, setSelectedHospital] = useState<any>(null);
  const [isDispatched, setIsDispatched] = useState<boolean>(false);

  // Unified Modal Wizard: Step 1 = Incident, Step 2 = Hospital, Step 3 = Start Confirmation
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [dispatchedData, setDispatchedData] = useState<any>(null);
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [dispatchingHospitalId, setDispatchingHospitalId] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  // End of Journey Popup Modal (Mission Complete)
  const [endPopupVisible, setEndPopupVisible] = useState<boolean>(false);
  const [endPopupData, setEndPopupData] = useState<any>(null);

  // Live Telemetry
  const [bypassedCount, setBypassedCount] = useState<number>(0);
  const [timeSaved, setTimeSaved] = useState<number>(0);
  const [ambulanceSpeed, setAmbulanceSpeed] = useState<number>(0);

  // Authentication & Role State
  const [currentUser, setCurrentUser] = useState<any>(null); // null = show login screen
  const [loginRole, setLoginRole] = useState<'driver' | 'admin'>('driver');
  const [loginId, setLoginId] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Admin View State
  const [adminTab, setAdminTab] = useState<'map' | 'analytics'>('map');
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState<boolean>(false);

  // Fleet & Admin Ambulance Inspector State
  const [fleetList, setFleetList] = useState<any[]>([
    {
      id: "AMB-108",
      name: "AMB-108 Rapid",
      driver: "Rajesh Kumar",
      driver_id: "driver1",
      vehicle_id: "AMB-108",
      status: "STANDBY",
      source: "Cyber Towers Junction",
      destination: "Medicover Hospital",
      speed: 0,
      lat: 17.4485,
      lon: 78.3908
    },
    {
      id: "AMB-102",
      name: "AMB-102 Trauma",
      driver: "Priya Sharma",
      driver_id: "driver2",
      vehicle_id: "AMB-102",
      status: "STANDBY",
      source: "Jubilee Hills Base",
      destination: "Standby Zone",
      speed: 0,
      lat: 17.45398,
      lon: 78.41576
    }
  ]);
  const [selectedFleetId, setSelectedFleetId] = useState<string>("AMB-108");

  const mapRef = useRef<any>(null);

  const activeSelectedFleet = fleetList.find(f => f.id === selectedFleetId) || fleetList[0];

  const fitToFullRoute = () => {
    if (!mapRef.current) return;
    const points: any[] = [];
    if (optimalRoute && optimalRoute.length > 0) {
      points.push(...optimalRoute);
    }
    if (ambulance) {
      points.push({ latitude: ambulance.latitude, longitude: ambulance.longitude });
    }
    if (selectedIncident) {
      points.push({ latitude: selectedIncident.lat, longitude: selectedIncident.lon });
    }
    if (selectedHospital) {
      points.push({ latitude: selectedHospital.lat, longitude: selectedHospital.lon });
    }
    if (points.length > 0) {
      mapRef.current.fitToCoordinates(points, {
        edgePadding: { top: 70, right: 50, bottom: 120, left: 50 },
        animated: true,
      });
    }
  };

  const resetAllState = () => {
    setAmbulance(null);
    setOptimalRoute([]);
    setAltRoute1([]);
    setAltRoute2([]);
    setTlsList([]);
    setUpcomingSignals([]);
    setGreenWaveActive(null);
    setCongestionAlert(null);
    setPendingReroute(null);
    setIsDispatched(false);
    setIsSimRunning(false);
    setBypassedCount(0);
    setTimeSaved(0);
    setAmbulanceSpeed(0);
    setRouteStats(null);
    setDispatchedData(null);
  };

  const refreshLocations = async () => {
    try {
      const incRes = await fetch(`${API_URL}/incidents`);
      if (incRes.ok) {
        const incData = await incRes.json();
        if (incData.incidents?.length > 0) setIncidents(incData.incidents);
      }
    } catch (e) {}

    try {
      const hospRes = await fetch(`${API_URL}/hospitals`);
      if (hospRes.ok) {
        const hospData = await hospRes.json();
        if (hospData.hospitals?.length > 0) setHospitals(hospData.hospitals);
      }
    } catch (e) {}

    try {
      const statRes = await fetch(`${API_URL}/status`);
      if (statRes.ok) {
        const statData = await statRes.json();
        if (statData.running || statData.active || statData.in_transit) {
          setIsSimRunning(true);
        }
      }
    } catch (e) {}

    try {
      const fleetRes = await fetch(`${API_URL}/fleet`);
      if (fleetRes.ok) {
        const fleetData = await fleetRes.json();
        if (fleetData.fleet?.length > 0) setFleetList(fleetData.fleet);
      }
    } catch (e) {}
  };

  useEffect(() => {
    refreshLocations();

    let ws: any = null;
    let reconnectTimer: any = null;

    const connectWS = () => {
      try {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
          setConnectionStatus("🟢 Live System Connected");
        };

        ws.onmessage = (e: any) => {
          try {
            const data = JSON.parse(e.data);

            if (data.type === "reset") {
              resetAllState();
              setIsSimRunning(false);
              setIsDispatched(false);
              return;
            }

            if (data.type === "update") {
              if (data.sim_running !== undefined) {
                setIsSimRunning(Boolean(data.sim_running));
              }

              if (data.journey_completed) {
                setEndPopupData(data.journey_completed);
                setEndPopupVisible(true);
                setIsDispatched(false);
                setIsSimRunning(false);
              }

              if (data.fleet && data.fleet.length > 0) {
                setFleetList(data.fleet);
              }

              if (data.dispatch_info) {
                const active = Boolean(data.dispatch_info.active);
                setIsDispatched(active);
                if (active) {
                  setIsSimRunning(true);
                  if (data.dispatch_info.incident) {
                    const matchInc = incidents.find(i => i.name === data.dispatch_info.incident);
                    if (matchInc) setSelectedIncident(matchInc);
                    else setSelectedIncident({ id: 'active_inc', name: data.dispatch_info.incident, lat: 17.45394, lon: 78.41173 });
                  }
                  if (data.dispatch_info.hospital) {
                    const matchHosp = hospitals.find(h => h.name === data.dispatch_info.hospital);
                    if (matchHosp) setSelectedHospital(matchHosp);
                    else setSelectedHospital({ id: 'active_hosp', name: data.dispatch_info.hospital, lat: 17.45145, lon: 78.39616 });
                  }
                }
              }

              if (data.ambulance) {
                setIsSimRunning(true);
                setAmbulance({
                  latitude: data.ambulance.lat,
                  longitude: data.ambulance.lon,
                  speed: data.ambulance.speed || 0,
                });
              }

              if (data.routes) {
                if (data.routes.optimal?.length > 0) setOptimalRoute(data.routes.optimal);
                if (data.routes.alt1?.length > 0) setAltRoute1(data.routes.alt1);
                if (data.routes.alt2?.length > 0) setAltRoute2(data.routes.alt2);
              }

              if (data.tls && data.tls.length > 0) {
                setTlsList(data.tls);
              }

              if (data.upcoming_signals) {
                setUpcomingSignals(data.upcoming_signals);
              }

              setGreenWaveActive(data.green_wave_active || null);

              setCongestionAlert(data.congestion_alert || null);
              setPendingReroute(data.pending_reroute || null);

              if (data.telemetry) {
                setBypassedCount(data.telemetry.bypassed || 0);
                setTimeSaved(data.telemetry.time_saved || 0);
                setAmbulanceSpeed(data.telemetry.speed || 0);
              }
            }
          } catch (err) {}
        };

        ws.onerror = () => {
          setConnectionStatus(`🟡 Reconnecting (${backendHost})...`);
        };

        ws.onclose = () => {
          setConnectionStatus("🔴 Offline (Reconnecting)");
          reconnectTimer = setTimeout(connectWS, 2500);
        };
      } catch (err) {
        setConnectionStatus("🔴 Offline");
        reconnectTimer = setTimeout(connectWS, 2500);
      }
    };

    connectWS();

    return () => {
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [WS_URL, API_URL, backendHost]);

  // Real-time GPS Location Tracking for iOS Mobile Driver in Hyderabad
  useEffect(() => {
    let locationSubscription: any = null;

    const startLocationService = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.log("Location permission not granted");
          return;
        }
        setHasLocationPermission(true);

        const initialPos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setDeviceLocation(initialPos);

        if (appMode === 'real_driver' && !isDispatched) {
          setAmbulance({
            latitude: initialPos.coords.latitude,
            longitude: initialPos.coords.longitude,
            speed: Math.round((initialPos.coords.speed || 0) * 3.6),
          });
        }

        locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000,
            distanceInterval: 2,
          },
          async (loc) => {
            setDeviceLocation(loc);

            if (appMode === 'real_driver') {
              const currentSpeed = Math.max(0, Math.round((loc.coords.speed || 0) * 3.6));
              setAmbulanceSpeed(currentSpeed);
              setAmbulance({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                speed: currentSpeed,
                heading: loc.coords.heading || 0,
              });

              // Stream telemetry to backend if active dispatch
              if (isDispatched) {
                try {
                  const res = await fetch(`${API_URL}/driver/telemetry`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      lat: loc.coords.latitude,
                      lon: loc.coords.longitude,
                      speed: currentSpeed,
                      heading: loc.coords.heading || 0,
                      accuracy: loc.coords.accuracy || 0,
                      driver_id: currentUser?.username || 'driver1',
                      driver_name: currentUser?.name || 'Rajesh Kumar',
                      vehicle_id: currentUser?.vehicle_id || 'AMB-108',
                      mission_id: dispatchedData?.mission_id,
                    }),
                  });

                  if (res.ok) {
                    const telRes = await res.json();
                    if (telRes.green_wave_active && telRes.green_wave_active !== lastSpokenSignal) {
                      setLastSpokenSignal(telRes.green_wave_active);
                      speakAlert(`Green wave clear at ${telRes.green_wave_active}`);
                    }
                  }
                } catch (err) {
                  // Silent catch for network hiccups while driving
                }
              }
            }
          }
        );
      } catch (err) {
        console.log("Error starting location tracking:", err);
      }
    };

    startLocationService();

    return () => {
      if (locationSubscription) {
        locationSubscription.remove();
      }
    };
  }, [appMode, isDispatched, API_URL, dispatchedData, currentUser, lastSpokenSignal]);

  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const res = await fetch(`${API_URL}/analytics`);
      if (res.ok) {
        const data = await res.json();
        setAnalyticsData(data);
      }
    } catch (e) {
      console.log("Analytics fetch error:", e);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginId.trim(),
          password: loginPassword.trim()
        })
      });
      const data = await res.json();
      if (data.authenticated) {
        setCurrentUser(data);
        if (data.role === 'admin') {
          fetchAnalytics();
        }
      } else {
        setLoginError(data.error || "Invalid ID or password. Please try again.");
      }
    } catch (e) {
      setLoginError("Connection failed. Check backend server connection.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    resetAllState();
    setModalVisible(false);
  };

  const handleToggleSimulation = async () => {
    if (isSimRunning || isDispatched) {
      setIsSimRunning(false);
      setIsDispatched(false);
      resetAllState();
      setModalVisible(false);
      try {
        await fetch(`${API_URL}/stop_sim`);
      } catch (e) {}
    } else {
      setIsSimRunning(true);
      try {
        await fetch(`${API_URL}/start_sim`);
      } catch (e) {}
    }
  };

  const openDispatchWizard = () => {
    refreshLocations();
    setWizardStep(1);
    setModalVisible(true);
  };

  const handleSelectIncident = (item: any) => {
    setSelectedIncident(item);
    setWizardStep(2);
  };

  // Step 2: Selecting Hospital transitions smoothly to Step 3 (Confirmation) in the SAME modal
  const handleSelectHospital = async (item: any) => {
    if (isDispatching) return;
    setIsDispatching(true);
    setDispatchingHospitalId(item.id);
    setDispatchError(null);
    setSelectedHospital(item);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    // REAL DRIVER MOVEMENT DISPATCH (Live GPS on iOS in Hyderabad)
    if (appMode === 'real_driver') {
      try {
        const originLat = selectedIncident?.lat || deviceLocation?.coords?.latitude || 17.4504;
        const originLon = selectedIncident?.lon || deviceLocation?.coords?.longitude || 78.3808;
        const originName = selectedIncident?.name || "📍 My Live Location (Hyderabad)";

        // 1. Fetch real road geometry across Hyderabad via OSRM
        const osrmData = await fetchOSRMRoute(
          { lat: originLat, lon: originLon },
          { lat: item.lat, lon: item.lon }
        );

        let realCoords: any[] = [];
        let realDistanceM = 0;
        if (osrmData && osrmData.coords.length > 0) {
          realCoords = osrmData.coords;
          realDistanceM = osrmData.distance_m;
        } else {
          realCoords = [
            { latitude: originLat, longitude: originLon },
            { latitude: item.lat, longitude: item.lon }
          ];
          realDistanceM = calculateHaversineDistance(originLat, originLon, item.lat, item.lon) * 1000;
        }

        const res = await fetch(`${API_URL}/driver/dispatch_real`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            pickup_lat: originLat,
            pickup_lon: originLon,
            pickup_name: originName,
            hospital_id: item.id,
            driver_name: currentUser?.name || "Rajesh Kumar",
            driver_id: currentUser?.username || "driver1",
            vehicle_id: currentUser?.vehicle_id || "AMB-108",
            route_coords: realCoords,
            route_length_m: realDistanceM
          })
        });

        const data = await res.json();
        if (res.ok && !data.error) {
          setIsDispatched(true);
          setIsSimRunning(true);
          setOptimalRoute(realCoords);
          setDispatchedData(data);
          setRouteStats({
            optimalKm: (realDistanceM / 1000).toFixed(1),
            alt1Km: ((realDistanceM * 1.25) / 1000).toFixed(1),
            alt2Km: ((realDistanceM * 1.40) / 1000).toFixed(1),
            incident: originName,
            hospital: item.name,
            signals: data.signals_count || 12
          });
          setModalVisible(false);

          // Audio voice cue for the driver
          speakAlert(`Emergency corridor active to ${item.name}. Green wave signals engaged.`);

          if (mapRef.current) {
            mapRef.current.fitToCoordinates(
              [
                { latitude: originLat, longitude: originLon },
                { latitude: item.lat, longitude: item.lon }
              ],
              {
                edgePadding: { top: 70, right: 70, bottom: 70, left: 70 },
                animated: true
              }
            );
          }
        } else {
          setDispatchError(data.error || "Failed to dispatch real driver mission.");
        }
      } catch (e: any) {
        if (e.name === "AbortError") {
          setDispatchError("Route request timed out. Please tap retry.");
        } else {
          setDispatchError(`Dispatch failed: ${e.message || "Network Timeout"}. Check backend host.`);
        }
      } finally {
        clearTimeout(timeoutId);
        setIsDispatching(false);
        setDispatchingHospitalId(null);
      }
      return;
    }

    // SIMULATION MODE (SUMO TraCI)
    try {
      const res = await fetch(
        `${API_URL}/dispatch?incident_id=${item.id === selectedIncident?.id ? item.id : selectedIncident?.id}&hospital_id=${item.id}&driver_name=${encodeURIComponent(currentUser?.name || "Rajesh Kumar")}&driver_id=${encodeURIComponent(currentUser?.username || "driver1")}&vehicle_id=${encodeURIComponent(currentUser?.vehicle_id || "AMB-108")}`,
        {
          method: "POST",
          signal: controller.signal
        }
      );
      const data = await res.json();
      if (res.ok && !data.error) {
        setIsDispatched(true);
        setIsSimRunning(true);
        setDispatchedData(data);
        setRouteStats({
          optimalKm: data.optimal_distance_m ? (data.optimal_distance_m / 1000).toFixed(1) : "1.5",
          alt1Km: data.alt1_distance_m ? (data.alt1_distance_m / 1000).toFixed(1) : "2.1",
          alt2Km: data.alt2_distance_m ? (data.alt2_distance_m / 1000).toFixed(1) : "2.4",
          incident: data.incident || selectedIncident?.name,
          hospital: data.hospital || item.name,
          signals: data.signals_count || 6
        });
        setModalVisible(false);

        // Auto-center map on pickup
        if (mapRef.current && selectedIncident) {
          mapRef.current.fitToCoordinates(
            [
              { latitude: selectedIncident.lat, longitude: selectedIncident.lon },
              { latitude: item.lat, longitude: item.lon }
            ],
            {
              edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
              animated: true
            }
          );
        }
      } else {
        setDispatchError(data.error || "Failed to dispatch ambulance route.");
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        setDispatchError("Route request timed out. Please tap retry.");
      } else {
        setDispatchError(`Connection failed: ${e.message || "Network Timeout"}. Please tap retry.`);
      }
    } finally {
      clearTimeout(timeoutId);
      setIsDispatching(false);
      setDispatchingHospitalId(null);
    }
  };

  // Step 3 Action: Dismisses modal cleanly to view the live map
  const handleStartJourney = () => {
    setModalVisible(false);
  };

  const handleSimulateCongestion = async () => {
    try {
      await fetch(`${API_URL}/inject_congestion`, { method: "POST" });
    } catch (e) {}
  };

  const handleApplyReroute = async () => {
    try {
      const res = await fetch(`${API_URL}/apply_reroute`, { method: "POST" });
      const data = await res.json();
      if (data.status === "reroute_applied") {
        setCongestionAlert(null);
        setPendingReroute(null);
      }
    } catch (e) {}
  };

  const centerOnAmbulance = () => {
    if (mapRef.current && ambulance) {
      mapRef.current.animateToRegion(
        {
          latitude: ambulance.latitude,
          longitude: ambulance.longitude,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        },
        500
      );
    }
  };

  const sortedHospitals = useMemo(() => {
    const originLat = selectedIncident?.lat || deviceLocation?.coords?.latitude || 17.4504;
    const originLon = selectedIncident?.lon || deviceLocation?.coords?.longitude || 78.3808;

    return [...hospitals].map(h => {
      const dist = calculateHaversineDistance(originLat, originLon, h.lat, h.lon);
      return {
        ...h,
        distanceKm: dist.toFixed(1),
        etaMin: Math.max(2, Math.round((dist / 35) * 60))
      };
    }).sort((a, b) => parseFloat(a.distanceKm) - parseFloat(b.distanceKm));
  }, [hospitals, selectedIncident, deviceLocation]);

  if (!currentUser) {
    return (
      <SafeAreaView style={styles.loginContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#111827" />
        <ScrollView contentContainerStyle={styles.loginScroll}>
          {/* Header Brand */}
          <View style={styles.loginBrandBox}>
            <View style={styles.loginIconWrap}>
              <Text style={{ fontSize: 40 }}>🚑</Text>
            </View>
            <Text style={styles.loginTitle}>SmartWay Fleet</Text>
            <Text style={styles.loginSubtitle}>
              Green Wave & AI Emergency Traffic Response
            </Text>
            <View style={styles.supabaseBadge}>
              <Text style={styles.supabaseBadgeText}>⚡ Supabase Cloud Database Connected</Text>
            </View>
          </View>

          {/* Role Segmented Tabs */}
          <View style={styles.roleTabs}>
            <TouchableOpacity
              style={[
                styles.roleTab,
                loginRole === 'driver' && styles.roleTabActive,
              ]}
              onPress={() => {
                setLoginRole('driver');
                setLoginId('driver1');
                setLoginPassword('123');
                setLoginError(null);
              }}
            >
              <Text style={[styles.roleTabText, loginRole === 'driver' && styles.roleTabTextActive]}>
                🚑 Ambulance Driver
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.roleTab,
                loginRole === 'admin' && styles.roleTabActive,
              ]}
              onPress={() => {
                setLoginRole('admin');
                setLoginId('admin');
                setLoginPassword('admin');
                setLoginError(null);
              }}
            >
              <Text style={[styles.roleTabText, loginRole === 'admin' && styles.roleTabTextActive]}>
                🛡️ Fleet Admin
              </Text>
            </TouchableOpacity>
          </View>

          {/* Login Card */}
          <View style={styles.loginCard}>
            <Text style={styles.loginCardHeading}>
              {loginRole === 'driver' ? "Driver Authentication" : "Fleet Operations Admin"}
            </Text>
            <Text style={styles.loginCardSub}>
              {loginRole === 'driver'
                ? "Sign in to access navigation, vehicle HUD, and traffic signal preemption."
                : "Sign in to access Supabase metrics, mission telemetry, and fleet analytics."}
            </Text>

            {loginError && (
              <View style={styles.loginErrorBox}>
                <Text style={styles.loginErrorText}>⚠️ {loginError}</Text>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                {loginRole === 'driver' ? "BADGE / DRIVER ID" : "ADMIN ID"}
              </Text>
              <TextInput
                style={styles.textInput}
                value={loginId}
                onChangeText={setLoginId}
                placeholder={loginRole === 'driver' ? "driver1" : "admin"}
                placeholderTextColor="#6B7280"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>PASSWORD</Text>
              <TextInput
                style={styles.textInput}
                value={loginPassword}
                onChangeText={setLoginPassword}
                placeholder="Enter password"
                placeholderTextColor="#6B7280"
                secureTextEntry
              />
            </View>

            {/* Quick Demo Fill Buttons */}
            <View style={styles.demoFillSection}>
              <Text style={styles.demoFillTitle}>QUICK DEMO ACCOUNTS:</Text>
              {loginRole === 'driver' ? (
                <View style={styles.demoButtonsRow}>
                  <TouchableOpacity
                    style={styles.demoChip}
                    onPress={() => {
                      setLoginId('driver1');
                      setLoginPassword('123');
                    }}
                  >
                    <Text style={styles.demoChipText}>🚑 Rajesh (AMB-108)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.demoChip}
                    onPress={() => {
                      setLoginId('driver2');
                      setLoginPassword('123');
                    }}
                  >
                    <Text style={styles.demoChipText}>🚑 Priya (AMB-102)</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.demoChip, { width: '100%' }]}
                  onPress={() => {
                    setLoginId('admin');
                    setLoginPassword('admin');
                  }}
                >
                  <Text style={[styles.demoChipText, { textAlign: 'center' }]}>
                    🛡️ Command Center Admin
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={styles.loginSubmitButton}
              disabled={loginLoading}
              onPress={handleLogin}
            >
              {loginLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.loginSubmitButtonText}>
                  {loginRole === 'driver' ? "Enter Emergency Navigation ➔" : "Open Admin Command Center ➔"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#111827" />

      {/* Top Header with User Profile & Logout */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            {currentUser?.role === 'admin' ? "🛡️ SmartWay Command" : "🚑 SmartWay Emergency"}
          </Text>
          <Text style={styles.headerSubtitle}>
            {currentUser?.role === 'admin'
              ? "Fleet Command & Supabase Telemetry"
              : `Driver: ${currentUser?.name} (${currentUser?.vehicle_id || 'AMB-108'})`}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={() => setHostModalVisible(true)}>
            <Text style={styles.statusBadge}>{connectionStatus} ⚙️</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutButtonText}>🚪 Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Driver Operational Mode Switcher Bar (Real Movement vs Simulation) */}
      {currentUser?.role === 'driver' && (
        <View style={styles.modeSwitcherBar}>
          <TouchableOpacity
            style={[
              styles.modeTab,
              appMode === 'real_driver' && styles.modeTabActiveReal,
            ]}
            onPress={() => {
              setAppMode('real_driver');
              speakAlert("Real movement mode enabled. Tracking live GPS in Hyderabad.");
            }}
          >
            <Text
              style={[
                styles.modeTabText,
                appMode === 'real_driver' && styles.modeTabTextActive,
              ]}
            >
              🚗 Real Driver (Live GPS)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeTab,
              appMode === 'simulation' && styles.modeTabActiveSim,
            ]}
            onPress={() => {
              setAppMode('simulation');
            }}
          >
            <Text
              style={[
                styles.modeTabText,
                appMode === 'simulation' && styles.modeTabTextActive,
              ]}
            >
              🎮 SUMO Simulation
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Admin View Switcher (Map vs Analytics) */}
      {currentUser?.role === 'admin' && (
        <View style={styles.adminTabBar}>
          <TouchableOpacity
            style={[
              styles.adminTabButton,
              adminTab === 'map' && styles.adminTabButtonActive,
            ]}
            onPress={() => setAdminTab('map')}
          >
            <Text
              style={[
                styles.adminTabButtonText,
                adminTab === 'map' && styles.adminTabButtonTextActive,
              ]}
            >
              🗺️ Fleet Map & Ambulances
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.adminTabButton,
              adminTab === 'analytics' && styles.adminTabButtonActive,
            ]}
            onPress={() => {
              setAdminTab('analytics');
              fetchAnalytics();
            }}
          >
            <Text
              style={[
                styles.adminTabButtonText,
                adminTab === 'analytics' && styles.adminTabButtonTextActive,
              ]}
            >
              📊 Supabase Analytics
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {currentUser?.role === 'admin' && adminTab === 'analytics' ? (
        <ScrollView style={styles.analyticsContainer} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {/* Header row */}
          <View style={styles.analyticsHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.analyticsMainTitle}>📈 Fleet Analytics & Metrics</Text>
              <Text style={styles.analyticsSubtitle}>
                Live Supabase Telemetry & Green Wave Preemption
              </Text>
            </View>
            <TouchableOpacity 
              style={styles.refreshButton}
              onPress={fetchAnalytics}
            >
              {analyticsLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.refreshButtonText}>🔄 Refresh</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Database Status Banner */}
          <View style={styles.storageStatusPill}>
            <Text style={styles.storageStatusText}>
              ☁️ Database: {analyticsData?.metrics?.storage_source === 'supabase' ? 'Supabase Cloud Synced (smartway_trips)' : 'Local Database (Online Sync Ready)'}
            </Text>
          </View>

          {/* KPI Metrics Grid */}
          <View style={styles.kpiGrid}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiIcon}>🚑</Text>
              <Text style={styles.kpiValue}>
                {analyticsData?.metrics?.total_missions ?? 0}
              </Text>
              <Text style={styles.kpiLabel}>TOTAL DISPATCHES</Text>
            </View>

            <View style={styles.kpiCard}>
              <Text style={styles.kpiIcon}>⏱️</Text>
              <Text style={[styles.kpiValue, { color: '#38BDF8' }]}>
                {analyticsData?.metrics?.total_minutes_saved ?? "0.0"}m
              </Text>
              <Text style={styles.kpiLabel}>MINUTES SAVED</Text>
            </View>

            <View style={styles.kpiCard}>
              <Text style={styles.kpiIcon}>🚦</Text>
              <Text style={[styles.kpiValue, { color: '#34D399' }]}>
                {analyticsData?.metrics?.total_signals_cleared ?? 0}
              </Text>
              <Text style={styles.kpiLabel}>SIGNALS CLEARED</Text>
            </View>

            <View style={styles.kpiCard}>
              <Text style={styles.kpiIcon}>⚡</Text>
              <Text style={[styles.kpiValue, { color: '#F87171' }]}>
                {analyticsData?.metrics?.average_speed_kmh ?? "52.0"} km/h
              </Text>
              <Text style={styles.kpiLabel}>AVG SPEED</Text>
            </View>
          </View>

          {/* Efficiency Summary Bar */}
          <View style={styles.efficiencyCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.efficiencyTitle}>⚡ Green Wave Preemption Efficiency</Text>
              <Text style={styles.efficiencySub}>
                Average delay reduction across Hyderabad corridors
              </Text>
            </View>
            <Text style={styles.efficiencyPercent}>94.2%</Text>
          </View>

          {/* Recent Mission Trip Logs */}
          <View style={styles.tripLogsCard}>
            <Text style={styles.tripLogsTitle}>📋 Stored Mission Trips</Text>
            <Text style={styles.tripLogsSub}>
              Synced with Supabase table: smartway_trips
            </Text>

            {(!analyticsData?.recent_trips || analyticsData.recent_trips.length === 0) ? (
              <View style={styles.emptyTripsBox}>
                <Text style={styles.emptyTripsText}>
                  No completed trips logged yet. Complete an emergency dispatch to view live trip logs!
                </Text>
              </View>
            ) : (
              analyticsData.recent_trips.map((trip: any, idx: number) => (
                <View key={`trip_${idx}`} style={styles.tripItemCard}>
                  <View style={styles.tripItemTop}>
                    <Text style={styles.tripDriverName}>
                      👨‍✈️ {trip.driver_name || "Emergency Driver"} ({trip.vehicle_id || "AMB-108"})
                    </Text>
                    <View style={styles.tripCompletedBadge}>
                      <Text style={styles.tripCompletedText}>🟢 COMPLETED</Text>
                    </View>
                  </View>

                  <Text style={styles.tripCorridorText}>
                    📍 {trip.source_name} ➔ 🏥 {trip.destination_name}
                  </Text>

                  <View style={styles.tripStatsRow}>
                    <Text style={styles.tripStatItem}>
                      🛣️ {trip.route_length_m ? (trip.route_length_m / 1000).toFixed(1) : "1.8"} km
                    </Text>
                    <Text style={styles.tripStatItem}>
                      ⏱️ {trip.time_taken_seconds || 48}s run
                    </Text>
                    <Text style={[styles.tripStatItem, { color: '#34D399' }]}>
                      ⚡ {Math.round(((trip.time_saved_seconds || 0) / 60) * 10) / 10}m saved
                    </Text>
                    <Text style={styles.tripStatItem}>
                      🚦 {trip.signals_bypassed || 0} signals
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      ) : (
        <>
          {currentUser?.role === 'admin' ? (
            <View style={styles.adminFleetPanel}>
              {/* Active Fleet Selector Carousel */}
              <View style={styles.adminFleetHeader}>
                <Text style={styles.adminFleetHeaderTitle}>EMERGENCY FLEET UNITS</Text>
                <Text style={styles.adminFleetHeaderCount}>
                  {fleetList.filter(f => f.status === 'IN_TRANSIT').length} ACTIVE • {fleetList.length} UNITS
                </Text>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fleetScrollContent}>
                {fleetList.map((amb) => {
                  const isSelected = selectedFleetId === amb.id;
                  const isLive = amb.status === 'IN_TRANSIT';
                  return (
                    <TouchableOpacity
                      key={amb.id}
                      style={[
                        styles.fleetUnitCard,
                        isSelected && styles.fleetUnitCardSelected,
                        isLive && styles.fleetUnitCardLive
                      ]}
                      onPress={() => setSelectedFleetId(amb.id)}
                    >
                      <View style={styles.fleetUnitTopRow}>
                        <Text style={styles.fleetUnitIcon}>🚑</Text>
                        <View style={[styles.fleetUnitBadge, isLive ? styles.badgeLive : styles.badgeStandby]}>
                          <Text style={[styles.fleetUnitBadgeText, isLive ? { color: '#34D399' } : { color: '#94A3B8' }]}>
                            {isLive ? '🟢 LIVE' : '⚪ STANDBY'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.fleetUnitName}>{amb.name}</Text>
                      <Text style={styles.fleetUnitDriver}>👤 {amb.driver}</Text>
                      {isLive ? (
                        <Text style={styles.fleetUnitSpeed}>⚡ {ambulanceSpeed || amb.speed || 55} km/h</Text>
                      ) : (
                        <Text style={styles.fleetUnitStation}>📍 {amb.source}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Selected Ambulance Mission & Route Inspector */}
              {activeSelectedFleet && (
                <View style={styles.adminInspectorCard}>
                  <View style={styles.inspectorHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inspectorUnitTitle}>
                        {activeSelectedFleet.name} ({activeSelectedFleet.id})
                      </Text>
                      <Text style={styles.inspectorDriverName}>
                        Operator: {activeSelectedFleet.driver}
                      </Text>
                    </View>
                    <View style={[
                      styles.inspectorStatusPill, 
                      activeSelectedFleet.status === 'IN_TRANSIT' ? styles.pillLive : styles.pillStandby
                    ]}>
                      <Text style={[
                        styles.inspectorStatusPillText,
                        activeSelectedFleet.status === 'IN_TRANSIT' ? { color: '#F87171' } : { color: '#94A3B8' }
                      ]}>
                        {activeSelectedFleet.status === 'IN_TRANSIT' ? '🚨 EMERGENCY DISPATCH' : '🅿️ STANDBY'}
                      </Text>
                    </View>
                  </View>

                  {activeSelectedFleet.status === 'IN_TRANSIT' ? (
                    <>
                      <View style={styles.inspectorRoutePath}>
                        <View style={styles.pathPoint}>
                          <Text style={styles.pathPointLabel}>📍 SOURCE / PICKUP</Text>
                          <Text style={styles.pathPointName} numberOfLines={1}>
                            {selectedIncident?.name || activeSelectedFleet.source || "Cyber Towers Junction"}
                          </Text>
                        </View>
                        <Text style={styles.pathArrow}>➔</Text>
                        <View style={styles.pathPoint}>
                          <Text style={styles.pathPointLabel}>🏥 DESTINATION</Text>
                          <Text style={styles.pathPointName} numberOfLines={1}>
                            {selectedHospital?.name || activeSelectedFleet.destination || "Medicover Hospital"}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.inspectorMetricsStrip}>
                        <View style={styles.inspectorMetric}>
                          <Text style={styles.inspectorMetricValue}>
                            {ambulanceSpeed || activeSelectedFleet.speed || 55} km/h
                          </Text>
                          <Text style={styles.inspectorMetricLabel}>SPEED</Text>
                        </View>
                        <View style={styles.inspectorMetricDivider} />
                        <View style={styles.inspectorMetric}>
                          <Text style={[styles.inspectorMetricValue, { color: '#38BDF8' }]}>
                            {timeSaved || activeSelectedFleet.time_saved_s || 0}s
                          </Text>
                          <Text style={styles.inspectorMetricLabel}>TIME SAVED</Text>
                        </View>
                        <View style={styles.inspectorMetricDivider} />
                        <View style={styles.inspectorMetric}>
                          <Text style={[styles.inspectorMetricValue, { color: '#10B981' }]}>
                            {bypassedCount || activeSelectedFleet.signals_cleared || 0} 🚦
                          </Text>
                          <Text style={styles.inspectorMetricLabel}>CLEARED</Text>
                        </View>
                      </View>

                      <View style={styles.inspectorActionButtons}>
                        <TouchableOpacity style={styles.actionBtn} onPress={centerOnAmbulance}>
                          <Text style={styles.actionBtnText}>🎯 Center Ambulance</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.actionBtn, styles.actionBtnSecondary]} onPress={fitToFullRoute}>
                          <Text style={styles.actionBtnSecondaryText}>🗺️ Fit Full Route</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <View style={styles.standbyInfoBox}>
                      <Text style={styles.standbyInfoText}>
                        Unit is stationed at {activeSelectedFleet.source}. Ready for driver dispatch.
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          ) : (
            <>
              {/* Real-time Telemetry Dashboard */}
              <View style={styles.dashboard}>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>BYPASSED SIGNALS</Text>
                  <Text style={[styles.statValue, { color: '#10B981' }]}>
                    {bypassedCount} 🚦
                  </Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>TIME SAVED</Text>
                  <Text style={[styles.statValue, { color: '#3B82F6' }]}>
                    {timeSaved}s
                  </Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>AMBULANCE SPEED</Text>
                  <Text style={[styles.statValue, { color: '#EF4444' }]}>
                    {ambulanceSpeed} km/h
                  </Text>
                </View>
              </View>

              {/* Dynamic Signal Visibility HUD */}
              {isDispatched && upcomingSignals.length > 0 && (
                <View style={styles.upcomingHudBar}>
                  <Text style={styles.hudLabel}>UPCOMING SIGNALS:</Text>
                  {upcomingSignals.map((sig, idx) => {
                    const isGreen = sig.state === "GREEN";
                    return (
                      <View
                        key={`hud_${idx}`}
                        style={[
                          styles.hudChip,
                          isGreen ? styles.hudChipGreen : styles.hudChipRed,
                        ]}
                      >
                        <Text style={styles.hudChipText}>
                          {isGreen ? "🟢" : "🔴"} {sig.name}:{" "}
                          <Text style={{ fontWeight: '800' }}>
                            {isGreen ? "GREEN (Wave Clear)" : `RED (${sig.distance_m}m)`}
                          </Text>
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Green Wave Preemption Alert */}
              {greenWaveActive && (
                <View style={styles.alertBanner}>
                  <Text style={styles.alertText}>
                    🟢 GREEN WAVE ENGAGED — {greenWaveActive} TURNED GREEN (200m)
                  </Text>
                </View>
              )}

              {/* Dynamic Traffic Congestion Warning & Reroute Prompt */}
              {congestionAlert && (
                <View style={styles.congestionWarningCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.congestionTitle}>
                      ⚠️ {congestionAlert.road_name}
                    </Text>
                    <Text style={styles.congestionSub}>
                      Heavy gridlock detected ahead (+{congestionAlert.delay_minutes} min delay).
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.rerouteActionButton}
                    onPress={handleApplyReroute}
                  >
                    <Text style={styles.rerouteActionButtonText}>⚡ Reroute Now (-6.2m)</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Google Maps-Style Route Selection Bar */}
              {isDispatched && routeStats && (
                <View style={styles.googleRouteBar}>
                  <View style={[styles.routeCard, styles.routeCardSelected]}>
                    <Text style={styles.routeTag}>FASTEST (GREEN WAVE)</Text>
                    <Text style={styles.routeMainText}>🔵 {routeStats.optimalKm} km</Text>
                    <Text style={styles.routeSubText}>Direct • {routeStats.signals} Signals</Text>
                  </View>

                  <View style={styles.routeCard}>
                    <Text style={[styles.routeTag, { color: '#94A3B8' }]}>ALT 1 (INORBIT)</Text>
                    <Text style={[styles.routeMainText, { color: '#CBD5E1' }]}>⚪ {routeStats.alt1Km} km</Text>
                    <Text style={styles.routeSubText}>+12 min • Traffic</Text>
                  </View>

                  <View style={styles.routeCard}>
                    <Text style={[styles.routeTag, { color: '#F87171' }]}>ALT 2 (CHECKPOST)</Text>
                    <Text style={[styles.routeMainText, { color: '#FCA5A5' }]}>🔴 {routeStats.alt2Km} km</Text>
                    <Text style={styles.routeSubText}>+6 min • Congested</Text>
                  </View>
                </View>
              )}
            </>
          )}

      {/* Interactive Map View */}
      {Platform.OS === 'web' ? (
        <View style={styles.webFallback}>
          <Text style={styles.webFallbackText}>
            Native Map active on iOS / Android Expo Go.
          </Text>
        </View>
      ) : (
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={styles.map}
          initialRegion={{
            latitude: 17.446,
            longitude: 78.402,
            latitudeDelta: 0.035,
            longitudeDelta: 0.035,
          }}
        >
          {/* Pickup Markers */}
          {!isDispatched &&
            incidents.map((inc) => (
              <Marker
                key={`inc_${inc.id}`}
                coordinate={{ latitude: inc.lat, longitude: inc.lon }}
                title={`📍 ${inc.name}`}
                description="Tap Dispatch to select this pickup"
                pinColor="orange"
              />
            ))}

          {isDispatched && selectedIncident && (
            <Marker
              coordinate={{
                latitude: selectedIncident.lat,
                longitude: selectedIncident.lon,
              }}
              title={`📍 Pickup: ${selectedIncident.name}`}
              pinColor="orange"
            />
          )}

          {/* Destination Hospital Marker */}
          {isDispatched && selectedHospital ? (
            <Marker
              coordinate={{
                latitude: selectedHospital.lat,
                longitude: selectedHospital.lon,
              }}
              title={`🏥 Destination: ${selectedHospital.name}`}
              pinColor="green"
            />
          ) : (
            hospitals.map((hosp) => (
              <Marker
                key={`hosp_${hosp.id}`}
                coordinate={{ latitude: hosp.lat, longitude: hosp.lon }}
                title={`🏥 ${hosp.name}`}
                pinColor="green"
              />
            ))
          )}

          {/* Traffic Signals: RED initially, GREEN within 200m */}
          {tlsList.map((tls) => {
            const isGreen = tls.state === "GREEN";
            return (
              <Marker
                key={`tls_${tls.id}`}
                coordinate={{ latitude: tls.lat, longitude: tls.lon }}
                title={`🚦 ${tls.name}`}
                description={isGreen ? "🟢 GREEN — Cleared for Ambulance" : "🔴 RED — Normal Traffic Stop"}
                pinColor={isGreen ? "#10B981" : "#EF4444"}
              />
            );
          })}

          {/* Google Maps Route 2 (Alternative 1 - Slate Gray) */}
          {altRoute1.length > 0 && (
            <Polyline
              coordinates={altRoute1}
              strokeColor="#94A3B8"
              strokeWidth={4}
              lineDashPattern={[6, 4]}
              zIndex={2}
            />
          )}

          {/* Google Maps Route 3 (Alternative 2 - Muted Coral/Red) */}
          {altRoute2.length > 0 && (
            <Polyline
              coordinates={altRoute2}
              strokeColor="#F87171"
              strokeWidth={4}
              lineDashPattern={[6, 4]}
              zIndex={3}
            />
          )}

          {/* Google Maps Route 1 (Optimal - Bold Bright Blue) */}
          {optimalRoute.length > 0 && (
            <Polyline
              coordinates={optimalRoute}
              strokeColor="#007AFF"
              strokeWidth={7}
              lineCap="round"
              lineJoin="round"
              zIndex={10}
            />
          )}

          {/* Live Ambulance Marker */}
          {ambulance && (
            <Marker
              coordinate={{
                latitude: ambulance.latitude,
                longitude: ambulance.longitude,
              }}
              title="🚑 Emergency Ambulance"
              description={`Speed: ${ambulanceSpeed} km/h`}
              pinColor="blue"
              zIndex={20}
            />
          )}
        </MapView>
      )}

      {/* Floating Center Button */}
      {ambulance && (
        <TouchableOpacity style={styles.centerButton} onPress={centerOnAmbulance}>
          <Text style={styles.centerButtonText}>🎯 Center</Text>
        </TouchableOpacity>
      )}

      {/* Simulate Traffic Bottleneck Button (Driver only) */}
      {currentUser?.role === 'driver' && isDispatched && (
        <TouchableOpacity
          style={styles.congestionButton}
          onPress={handleSimulateCongestion}
        >
          <Text style={styles.congestionButtonText}>⚠️ Simulate Traffic Jam</Text>
        </TouchableOpacity>
      )}

      {/* Bottom Action Controls */}
      {currentUser?.role === 'driver' ? (
        <View style={styles.controls}>
          <TouchableOpacity
            style={[
              styles.simButton,
              (isSimRunning || isDispatched) ? styles.simButtonRunning : styles.simButtonStopped,
              (!isSimRunning && !isDispatched) && { flex: 1, paddingVertical: 16 },
            ]}
            onPress={handleToggleSimulation}
          >
            <Text style={[styles.simButtonText, (!isSimRunning && !isDispatched) && { fontSize: 16, fontWeight: '800' }]}>
              {(isSimRunning || isDispatched) ? "⏹️ Stop Simulation" : "▶️ Start Simulation"}
            </Text>
          </TouchableOpacity>

          {(isSimRunning || isDispatched) && (
            <TouchableOpacity style={styles.dispatchButton} onPress={openDispatchWizard}>
              <Text style={styles.dispatchButtonText}>
                {isDispatched ? "🔄 Re-Dispatch" : "🚨 Dispatch Emergency"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={styles.adminFooterBar}>
          <View style={styles.adminFooterDot} />
          <Text style={styles.adminFooterText}>
            🛡️ Command Center Active • Real-time Corridor & Traffic Signal Preemption Observer
          </Text>
        </View>
      )}
      </>
      )}

      {/* SINGLE UNIFIED WIZARD MODAL (Driver Only) */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible && currentUser?.role === 'driver'}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {wizardStep === 1 && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalStepBadge}>STEP 1 OF 3</Text>
                  <Text style={styles.modalTitle}>Select Incident / Pickup Point</Text>
                  <Text style={styles.modalSubtitle}>Where is the emergency located?</Text>
                </View>

                <FlatList
                  data={incidents}
                  keyExtractor={(item) => item.id}
                  ListHeaderComponent={() => (
                    <TouchableOpacity
                      style={[
                        styles.locationCard,
                        { borderColor: '#10B981', borderWidth: 2, backgroundColor: '#064E3B', marginBottom: 12 }
                      ]}
                      onPress={() => {
                        if (deviceLocation) {
                          handleSelectIncident({
                            id: 'live_gps',
                            name: '📍 My Live Location (Hyderabad)',
                            address: `${deviceLocation.coords.latitude.toFixed(4)}°N, ${deviceLocation.coords.longitude.toFixed(4)}°E (Accuracy: ±${Math.round(deviceLocation.coords.accuracy || 5)}m)`,
                            lat: deviceLocation.coords.latitude,
                            lon: deviceLocation.coords.longitude,
                          });
                        } else {
                          Alert.alert("Acquiring GPS", "Detecting your phone's GPS position in Hyderabad. Please verify location permissions.");
                        }
                      }}
                    >
                      <View style={[styles.locationIconWrap, { backgroundColor: '#059669' }]}>
                        <Text style={styles.locationIcon}>🎯</Text>
                      </View>
                      <View style={styles.locationTextWrap}>
                        <Text style={[styles.locationName, { color: '#34D399', fontWeight: '800' }]}>
                          📍 Use My Current Location
                        </Text>
                        <Text style={[styles.locationAddress, { color: '#A7F3D0' }]}>
                          {deviceLocation
                            ? `${deviceLocation.coords.latitude.toFixed(4)}°N, ${deviceLocation.coords.longitude.toFixed(4)}°E • Real-time GPS Fix`
                            : "Acquiring GPS coordinates in Hyderabad..."}
                        </Text>
                      </View>
                      <Text style={[styles.locationSelectArrow, { color: '#34D399' }]}>➔</Text>
                    </TouchableOpacity>
                  )}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.locationCard}
                      onPress={() => handleSelectIncident(item)}
                    >
                      <View style={styles.locationIconWrap}>
                        <Text style={styles.locationIcon}>📍</Text>
                      </View>
                      <View style={styles.locationTextWrap}>
                        <Text style={styles.locationName}>{item.name}</Text>
                        <Text style={styles.locationAddress}>{item.address}</Text>
                      </View>
                      <Text style={styles.locationSelectArrow}>➔</Text>
                    </TouchableOpacity>
                  )}
                />

                <TouchableOpacity
                  style={styles.modalCloseButton}
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={styles.modalCloseText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}

            {wizardStep === 2 && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalStepBadge}>STEP 2 OF 3</Text>
                  <Text style={styles.modalTitle}>Select Destination Hospital</Text>
                  <Text style={styles.modalSubtitle}>
                    Pickup: <Text style={{ fontWeight: 'bold' }}>{selectedIncident?.name}</Text>
                  </Text>
                </View>

                {dispatchError && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorBoxText}>⚠️ {dispatchError}</Text>
                    <TouchableOpacity onPress={() => setDispatchError(null)}>
                      <Text style={styles.errorDismissBtn}>Dismiss</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <FlatList
                  data={sortedHospitals}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => {
                    const isThisLoading = isDispatching && dispatchingHospitalId === item.id;
                    return (
                      <TouchableOpacity
                        style={[
                          styles.locationCard,
                          styles.hospitalCard,
                          isThisLoading && styles.hospitalCardActive,
                          isDispatching && !isThisLoading && { opacity: 0.45 },
                        ]}
                        disabled={isDispatching}
                        onPress={() => handleSelectHospital(item)}
                      >
                        <View style={[styles.locationIconWrap, { backgroundColor: isThisLoading ? '#FEF08A' : '#DCFCE7' }]}>
                          {isThisLoading ? (
                            <ActivityIndicator size="small" color="#CA8A04" />
                          ) : (
                            <Text style={styles.locationIcon}>🏥</Text>
                          )}
                        </View>
                        <View style={styles.locationTextWrap}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={[styles.locationName, { flex: 1 }]}>{item.name}</Text>
                            {item.distanceKm && (
                              <View style={styles.distBadge}>
                                <Text style={styles.distBadgeText}>{item.distanceKm} km</Text>
                              </View>
                            )}
                          </View>
                          <Text style={[styles.locationAddress, isThisLoading && { color: '#CA8A04', fontWeight: '700' }]}>
                            {isThisLoading
                              ? "Computing Real Road Corridor & Preemption..."
                              : `${item.etaMin ? `~${item.etaMin} min • ` : ""}${item.address} • ${item.icu_beds_available || 8} ICU Beds`}
                          </Text>
                        </View>
                        <Text style={[styles.locationSelectArrow, { color: isThisLoading ? '#CA8A04' : '#16A34A' }]}>
                          {isThisLoading ? "⏳" : "➔"}
                        </Text>
                      </TouchableOpacity>
                    );
                  }}
                />

                <TouchableOpacity
                  style={[styles.modalCloseButton, isDispatching && { opacity: 0.5 }]}
                  disabled={isDispatching}
                  onPress={() => {
                    setDispatchError(null);
                    setWizardStep(1);
                  }}
                >
                  <Text style={styles.modalCloseText}>Back to Pickup</Text>
                </TouchableOpacity>
              </>
            )}

            {wizardStep === 3 && dispatchedData && (
              <>
                <View style={{ alignItems: 'center', marginBottom: 16 }}>
                  <View style={styles.popupIconCircle}>
                    <Text style={{ fontSize: 32 }}>🚨</Text>
                  </View>
                  <Text style={styles.popupTitle}>Emergency Journey Ready!</Text>
                  <Text style={styles.popupSub}>Fastest Green Wave Route Configured</Text>
                </View>

                <View style={styles.popupDetailsBox}>
                  <Text style={styles.popupDetailRow}>
                    📍 <Text style={styles.popupBold}>Pickup:</Text> {dispatchedData.incident}
                  </Text>
                  <Text style={styles.popupDetailRow}>
                    🏥 <Text style={styles.popupBold}>Destination:</Text> {dispatchedData.hospital}
                  </Text>
                  <Text style={styles.popupDetailRow}>
                    🛣️ <Text style={styles.popupBold}>Distance:</Text> {dispatchedData.distance} km
                  </Text>
                  <Text style={styles.popupDetailRow}>
                    🚦 <Text style={styles.popupBold}>Signals Synced:</Text> {dispatchedData.signals} intersections
                  </Text>
                </View>

                <Text style={styles.popupNote}>
                  Signals ahead will automatically turn green within 200m of your approach.
                </Text>

                <TouchableOpacity
                  style={styles.popupPrimaryButton}
                  onPress={handleStartJourney}
                >
                  <Text style={styles.popupPrimaryButtonText}>Start Journey 🚑</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Backend Host & Tunnel Config Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={hostModalVisible}
        onRequestClose={() => setHostModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🌐 Server & Tunnel Settings</Text>
            <Text style={styles.modalSubtitle}>
              When driving on mobile cellular data (4G/5G) in Hyderabad, enter your Ngrok tunnel URL or your local network IP:
            </Text>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 8 }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  backgroundColor: hostInput.includes('onrender.com') ? '#065F46' : '#1E293B',
                  borderColor: hostInput.includes('onrender.com') ? '#10B981' : '#334155',
                  borderWidth: 1,
                  borderRadius: 10,
                  paddingVertical: 10,
                  paddingHorizontal: 8,
                  alignItems: 'center',
                }}
                onPress={() => setHostInput(RENDER_CLOUD_HOST)}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>☁️ Render Cloud</Text>
                <Text style={{ color: '#6EE7B7', fontSize: 9, marginTop: 2 }}>24/7 4G/5G Driving</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flex: 1,
                  backgroundColor: !hostInput.includes('onrender.com') ? '#1E3A8A' : '#1E293B',
                  borderColor: !hostInput.includes('onrender.com') ? '#3B82F6' : '#334155',
                  borderWidth: 1,
                  borderRadius: 10,
                  paddingVertical: 10,
                  paddingHorizontal: 8,
                  alignItems: 'center',
                }}
                onPress={() => setHostInput(getLocalBackendHost())}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>🏠 Local PC</Text>
                <Text style={{ color: '#93C5FD', fontSize: 9, marginTop: 2 }}>Home Wi-Fi SUMO</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.textInput, { marginTop: 6 }]}
              value={hostInput}
              onChangeText={setHostInput}
              placeholder="e.g. smartway-backend-ir79.onrender.com or 192.168.1.12"
              placeholderTextColor="#64748B"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.modalCloseButton, { flex: 1 }]}
                onPress={() => setHostModalVisible(false)}
              >
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.loginSubmitButton, { flex: 1, marginTop: 0 }]}
                onPress={() => {
                  if (hostInput.trim()) {
                    setBackendHost(hostInput.trim());
                    setConnectionStatus(`Connecting (${hostInput.trim()})...`);
                  }
                  setHostModalVisible(false);
                }}
              >
                <Text style={styles.loginSubmitButtonText}>Save & Connect</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* END OF JOURNEY POPUP MODAL (MISSION COMPLETE & THANK YOU) */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={endPopupVisible}
        onRequestClose={() => {
          setEndPopupVisible(false);
          resetAllState();
        }}
      >
        <View style={styles.popupOverlay}>
          <View style={[styles.popupCard, { borderColor: '#10B981', borderWidth: 2 }]}>
            <View style={[styles.popupIconCircle, { backgroundColor: '#064E3B' }]}>
              <Text style={{ fontSize: 36 }}>🎉</Text>
            </View>
            <Text style={styles.popupTitle}>Patient Delivered Safely!</Text>
            <Text style={[styles.popupSub, { color: '#6EE7B7' }]}>
              Mission Successfully Completed
            </Text>

            {endPopupData && (
              <View style={[styles.popupDetailsBox, { borderColor: '#059669' }]}>
                <Text style={styles.popupDetailRow}>
                  🏥 <Text style={styles.popupBold}>Arrived at:</Text> {endPopupData.hospital}
                </Text>
                <Text style={styles.popupDetailRow}>
                  ⚡ <Text style={styles.popupBold}>Total Time Saved:</Text> {endPopupData.minutes_saved} min ({endPopupData.time_saved_seconds}s)
                </Text>
                <Text style={styles.popupDetailRow}>
                  🚦 <Text style={styles.popupBold}>Signals Preempted:</Text> {endPopupData.bypassed_signals} intersections
                </Text>
              </View>
            )}

            <View style={styles.thankYouBox}>
              <Text style={styles.thankYouHeading}>🩺 Thank You, Captain!</Text>
              <Text style={styles.thankYouText}>
                Your rapid emergency response and Green Wave preemption saved crucial minutes today!
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.popupPrimaryButton, { backgroundColor: '#059669' }]}
              onPress={() => {
                setEndPopupVisible(false);
                resetAllState();
              }}
            >
              <Text style={styles.popupPrimaryButtonText}>Complete Mission 🏁</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: '#111827',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  statusBadge: {
    fontSize: 11,
    color: '#D1D5DB',
    backgroundColor: '#1F2937',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  dashboard: {
    flexDirection: 'row',
    backgroundColor: '#1F2937',
    paddingVertical: 8,
    paddingHorizontal: 12,
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 26,
    backgroundColor: '#374151',
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 17,
    fontWeight: '800',
  },
  upcomingHudBar: {
    backgroundColor: '#1E293B',
    paddingVertical: 6,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  hudLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
  },
  hudChip: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  hudChipRed: {
    backgroundColor: '#450A0A',
    borderColor: '#DC2626',
  },
  hudChipGreen: {
    backgroundColor: '#064E3B',
    borderColor: '#10B981',
  },
  hudChipText: {
    fontSize: 10,
    color: '#F8FAFC',
  },
  alertBanner: {
    backgroundColor: '#065F46',
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#047857',
  },
  alertText: {
    color: '#6EE7B7',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  congestionWarningCard: {
    backgroundColor: '#7F1D1D',
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#EF4444',
  },
  congestionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FEE2E2',
  },
  congestionSub: {
    fontSize: 10,
    color: '#FCA5A5',
    marginTop: 2,
  },
  rerouteActionButton: {
    backgroundColor: '#EF4444',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginLeft: 8,
  },
  rerouteActionButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
  },
  googleRouteBar: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    paddingVertical: 8,
    paddingHorizontal: 8,
    justifyContent: 'space-between',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  routeCard: {
    flex: 1,
    backgroundColor: '#1F2937',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
  },
  routeCardSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#0F2744',
  },
  routeTag: {
    fontSize: 8,
    fontWeight: '800',
    color: '#60A5FA',
    marginBottom: 2,
  },
  routeMainText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  routeSubText: {
    fontSize: 9,
    color: '#9CA3AF',
    marginTop: 2,
    textAlign: 'center',
  },
  map: {
    flex: 1,
  },
  webFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  webFallbackText: {
    color: '#FFFFFF',
    textAlign: 'center',
  },
  centerButton: {
    position: 'absolute',
    right: 16,
    top: 200,
    backgroundColor: '#1F2937',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#374151',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  centerButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  congestionButton: {
    position: 'absolute',
    left: 16,
    top: 200,
    backgroundColor: '#7F1D1D',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DC2626',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  congestionButtonText: {
    color: '#FEE2E2',
    fontWeight: '700',
    fontSize: 11,
  },
  controls: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  simButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  simButtonStopped: {
    backgroundColor: '#059669',
  },
  simButtonRunning: {
    backgroundColor: '#DC2626',
  },
  simButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  dispatchButton: {
    flex: 1.4,
    backgroundColor: '#DC2626',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  dispatchButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#1F2937',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    maxHeight: '80%',
  },
  modalHeader: {
    marginBottom: 16,
  },
  modalStepBadge: {
    color: '#3B82F6',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
  },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#374151',
  },
  hospitalCard: {
    borderColor: '#065F46',
  },
  locationIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#374151',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  locationIcon: {
    fontSize: 18,
  },
  locationTextWrap: {
    flex: 1,
  },
  locationName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  locationAddress: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  locationSelectArrow: {
    fontSize: 16,
    color: '#3B82F6',
    fontWeight: '700',
    marginLeft: 8,
  },
  modalCloseButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#374151',
  },
  modalCloseText: {
    color: '#D1D5DB',
    fontWeight: '700',
    fontSize: 14,
  },
  popupOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  popupCard: {
    backgroundColor: '#1F2937',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
  },
  popupIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#374151',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  popupTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  popupSub: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
    marginBottom: 16,
    textAlign: 'center',
  },
  popupDetailsBox: {
    width: '100%',
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#374151',
  },
  popupDetailRow: {
    color: '#E5E7EB',
    fontSize: 13,
    marginBottom: 6,
  },
  popupBold: {
    fontWeight: '700',
    color: '#FFFFFF',
  },
  popupNote: {
    color: '#9CA3AF',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 16,
  },
  popupPrimaryButton: {
    width: '100%',
    backgroundColor: '#DC2626',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  popupPrimaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  thankYouBox: {
    backgroundColor: '#064E3B',
    borderRadius: 12,
    padding: 12,
    width: '100%',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#059669',
  },
  thankYouHeading: {
    color: '#A7F3D0',
    fontWeight: '800',
    fontSize: 14,
    marginBottom: 4,
    textAlign: 'center',
  },
  thankYouText: {
    color: '#D1FAE5',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
  hospitalCardActive: {
    borderColor: '#EAB308',
    backgroundColor: '#374151',
  },
  errorBox: {
    backgroundColor: '#7F1D1D',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  errorBoxText: {
    color: '#FEE2E2',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  errorDismissBtn: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  // ================= LOGIN SCREEN STYLES =================
  loginContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loginScroll: {
    paddingHorizontal: 20,
    paddingVertical: 28,
    alignItems: 'center',
  },
  loginBrandBox: {
    alignItems: 'center',
    marginBottom: 24,
  },
  loginIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#DC2626',
    marginBottom: 12,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  loginTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#F8FAFC',
    letterSpacing: 0.5,
  },
  loginSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 4,
    textAlign: 'center',
  },
  supabaseBadge: {
    marginTop: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  supabaseBadgeText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '700',
  },
  roleTabs: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: '#334155',
  },
  roleTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  roleTabActive: {
    backgroundColor: '#DC2626',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  roleTabText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
  },
  roleTabTextActive: {
    color: '#FFFFFF',
  },
  loginCard: {
    width: '100%',
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  loginCardHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  loginCardSub: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 16,
    marginBottom: 16,
  },
  loginErrorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
  },
  loginErrorText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#334155',
  },
  demoFillSection: {
    marginTop: 6,
    marginBottom: 20,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  demoFillTitle: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  demoButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  demoChip: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
    alignItems: 'center',
  },
  demoChipText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
  },
  loginSubmitButton: {
    backgroundColor: '#DC2626',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  loginSubmitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  logoutButton: {
    backgroundColor: '#374151',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4B5563',
  },
  logoutButtonText: {
    color: '#E5E7EB',
    fontSize: 11,
    fontWeight: '700',
  },

  // ================= ADMIN TAB BAR & DASHBOARD =================
  adminTabBar: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    gap: 8,
  },
  adminTabButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  adminTabButtonActive: {
    backgroundColor: '#2563EB',
    borderColor: '#3B82F6',
  },
  adminTabButtonText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  adminTabButtonTextActive: {
    color: '#FFFFFF',
  },

  // ================= ANALYTICS STYLES =================
  analyticsContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  analyticsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  analyticsMainTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#F8FAFC',
  },
  analyticsSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  refreshButton: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  refreshButtonText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  storageStatusPill: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  storageStatusText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  kpiCard: {
    width: '48%',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  kpiIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#F8FAFC',
    marginVertical: 2,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  efficiencyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    marginBottom: 16,
  },
  efficiencyTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#34D399',
  },
  efficiencySub: {
    fontSize: 11,
    color: '#A7F3D0',
    marginTop: 2,
  },
  efficiencyPercent: {
    fontSize: 24,
    fontWeight: '900',
    color: '#10B981',
    marginLeft: 12,
  },
  tripLogsCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  tripLogsTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  tripLogsSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
    marginBottom: 14,
  },
  emptyTripsBox: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  emptyTripsText: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  tripItemCard: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  tripItemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  tripDriverName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  tripCompletedBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tripCompletedText: {
    color: '#34D399',
    fontSize: 9,
    fontWeight: '800',
  },
  tripCorridorText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  tripStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    paddingTop: 8,
  },
  tripStatItem: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginRight: 6,
  },

  // ================= ADMIN FLEET & INSPECTOR STYLES =================
  adminFleetPanel: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  adminFleetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  adminFleetHeaderTitle: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  adminFleetHeaderCount: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '700',
  },
  fleetScrollContent: {
    gap: 8,
    paddingBottom: 4,
  },
  fleetUnitCard: {
    width: 140,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  fleetUnitCardSelected: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
  },
  fleetUnitCardLive: {
    borderColor: '#10B981',
  },
  fleetUnitTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  fleetUnitIcon: {
    fontSize: 16,
  },
  fleetUnitBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeLive: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  badgeStandby: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
  },
  fleetUnitBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  fleetUnitName: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '800',
  },
  fleetUnitDriver: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 2,
  },
  fleetUnitSpeed: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 3,
  },
  fleetUnitStation: {
    color: '#64748B',
    fontSize: 9,
    marginTop: 3,
  },

  // Inspector card
  adminInspectorCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  inspectorHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  inspectorUnitTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '900',
  },
  inspectorDriverName: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 1,
  },
  inspectorStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  pillLive: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  pillStandby: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
  },
  inspectorStatusPillText: {
    fontSize: 10,
    fontWeight: '800',
  },

  inspectorRoutePath: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  pathPoint: {
    flex: 1,
  },
  pathPointLabel: {
    color: '#64748B',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  pathPointName: {
    color: '#F1F5F9',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  pathArrow: {
    color: '#38BDF8',
    fontSize: 14,
    paddingHorizontal: 8,
    fontWeight: '900',
  },

  inspectorMetricsStrip: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  inspectorMetric: {
    alignItems: 'center',
  },
  inspectorMetricValue: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '900',
  },
  inspectorMetricLabel: {
    color: '#94A3B8',
    fontSize: 8,
    fontWeight: '800',
    marginTop: 1,
  },
  inspectorMetricDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#334155',
  },

  inspectorActionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#2563EB',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  actionBtnSecondary: {
    backgroundColor: '#334155',
  },
  actionBtnSecondaryText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
  },

  standbyInfoBox: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  standbyInfoText: {
    color: '#94A3B8',
    fontSize: 11,
    textAlign: 'center',
  },

  adminFooterBar: {
    backgroundColor: '#1E293B',
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  adminFooterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  adminFooterText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },

  // Operational Mode Switcher Bar Styles
  modeSwitcherBar: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    padding: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    gap: 8,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  modeTabActiveReal: {
    backgroundColor: '#065F46',
    borderColor: '#10B981',
  },
  modeTabActiveSim: {
    backgroundColor: '#1E3A8A',
    borderColor: '#3B82F6',
  },
  modeTabText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  modeTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  distBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#059669',
    marginLeft: 8,
  },
  distBadgeText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '800',
  },
});
