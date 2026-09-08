import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  Platform,
  Modal,
  FlatList,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import Constants from 'expo-constants';

// Automatically detect host IP from Expo Go connection with fallback
const getBackendHost = () => {
  const hostUri = Constants.expoConfig?.hostUri || Constants.manifest2?.extra?.expoGo?.debuggerHost;
  if (hostUri) {
    return hostUri.split(':')[0];
  }
  return '192.168.1.12';
};

const HOST = getBackendHost();
const WS_URL = `ws://${HOST}:8000/ws`;
const API_URL = `http://${HOST}:8000`;

const DEFAULT_INCIDENTS = [
  {
    id: "i1",
    name: "Cyber Towers Junction",
    address: "Hitec City Main Road",
    lat: 17.45394,
    lon: 78.41173
  },
  {
    id: "i2",
    name: "Inorbit Mall Road",
    address: "Durgam Cheruvu Link, Madhapur",
    lat: 17.44348,
    lon: 78.39361
  },
  {
    id: "i3",
    name: "Jubilee Hills Checkpost",
    address: "Road No. 36, Jubilee Hills",
    lat: 17.45398,
    lon: 78.41576
  },
  {
    id: "i4",
    name: "Durgam Cheruvu Bridge",
    address: "Cable Stayed Bridge, Madhapur",
    lat: 17.43397,
    lon: 78.40020
  },
  {
    id: "i5",
    name: "Madhapur Metro Station",
    address: "Ayyappa Society Main Road",
    lat: 17.45342,
    lon: 78.41408
  }
];

const DEFAULT_HOSPITALS = [
  {
    id: "h1",
    name: "Apollo Hospitals, Jubilee Hills",
    address: "Road No. 72, Jubilee Hills",
    lat: 17.44732,
    lon: 78.40735
  },
  {
    id: "h2",
    name: "Medicover Hospital, Hitec City",
    address: "Opp. Cyber Towers, Madhapur",
    lat: 17.45145,
    lon: 78.39616
  },
  {
    id: "h3",
    name: "KIMS Hospital, Kondapur",
    address: "Hitec City - Kondapur Road",
    lat: 17.45150,
    lon: 78.39668
  },
  {
    id: "h4",
    name: "Care Hospitals, Banjara Link",
    address: "Road No. 1, Jubilee Hills",
    lat: 17.45400,
    lon: 78.41839
  }
];

export default function HomeScreen() {
  const [connectionStatus, setConnectionStatus] = useState(`Connecting (${HOST})...`);
  const [isSimRunning, setIsSimRunning] = useState(false);
  const [ambulance, setAmbulance] = useState(null);

  // Candidate routes
  const [optimalRoute, setOptimalRoute] = useState([]);
  const [altRoute1, setAltRoute1] = useState([]);
  const [altRoute2, setAltRoute2] = useState([]);
  const [routeStats, setRouteStats] = useState(null);

  // Traffic signals & Upcoming Signal HUD
  const [tlsList, setTlsList] = useState([]);
  const [upcomingSignals, setUpcomingSignals] = useState([]);
  const [greenWaveActive, setGreenWaveActive] = useState(null);

  // Dynamic Congestion & Reroute states
  const [congestionAlert, setCongestionAlert] = useState(null);
  const [pendingReroute, setPendingReroute] = useState(null);

  // Selection states
  const [incidents, setIncidents] = useState(DEFAULT_INCIDENTS);
  const [hospitals, setHospitals] = useState(DEFAULT_HOSPITALS);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [isDispatched, setIsDispatched] = useState(false);

  // Unified Modal Wizard: Step 1 = Incident, Step 2 = Hospital, Step 3 = Start Confirmation
  const [modalVisible, setModalVisible] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [dispatchedData, setDispatchedData] = useState(null);

  // End of Journey Popup Modal (Mission Complete)
  const [endPopupVisible, setEndPopupVisible] = useState(false);
  const [endPopupData, setEndPopupData] = useState(null);

  // Live Telemetry
  const [bypassedCount, setBypassedCount] = useState(0);
  const [timeSaved, setTimeSaved] = useState(0);
  const [ambulanceSpeed, setAmbulanceSpeed] = useState(0);

  const mapRef = useRef(null);

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
        setIsSimRunning(statData.running);
      }
    } catch (e) {}
  };

  useEffect(() => {
    refreshLocations();

    let ws = null;
    let reconnectTimer = null;

    const connectWS = () => {
      try {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
          setConnectionStatus("🟢 Live System Connected");
        };

        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);

            if (data.type === "reset") {
              resetAllState();
              return;
            }

            if (data.type === "update") {
              setIsSimRunning(true);

              if (data.journey_completed) {
                setEndPopupData(data.journey_completed);
                setEndPopupVisible(true);
              }

              if (data.ambulance) {
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
          setConnectionStatus(`🟡 Reconnecting (${HOST})...`);
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
  }, []);

  const handleToggleSimulation = async () => {
    if (isSimRunning) {
      resetAllState();
      try {
        fetch(`${API_URL}/stop_sim`);
      } catch (e) {}
    } else {
      setIsSimRunning(true);
      try {
        fetch(`${API_URL}/start_sim`);
      } catch (e) {}
    }
  };

  const openDispatchWizard = () => {
    refreshLocations();
    setWizardStep(1);
    setModalVisible(true);
  };

  const handleSelectIncident = (item) => {
    setSelectedIncident(item);
    setWizardStep(2);
  };

  // Step 2: Selecting Hospital transitions smoothly to Step 3 (Confirmation) in the SAME modal
  const handleSelectHospital = async (item) => {
    setSelectedHospital(item);

    try {
      const incId = selectedIncident?.id || "i1";
      const hospId = item.id;
      const url = `${API_URL}/dispatch?incident_id=${incId}&hospital_id=${hospId}`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();

      if (data.status === "dispatched") {
        setIsDispatched(true);
        setIsSimRunning(true);
        setBypassedCount(0);
        setTimeSaved(0);
        setRouteStats({
          optimalKm: (data.optimal_distance_m / 1000).toFixed(1),
          alt1Km: (data.alt1_distance_m / 1000).toFixed(1),
          alt2Km: (data.alt2_distance_m / 1000).toFixed(1),
          signals: data.signals_count,
        });

        setDispatchedData({
          incident: data.incident,
          hospital: data.hospital,
          distance: (data.optimal_distance_m / 1000).toFixed(1),
          signals: data.signals_count,
        });

        // Advance to Step 3 (Journey Ready) inside the same modal
        setWizardStep(3);

        if (mapRef.current && selectedIncident && item) {
          mapRef.current.fitToCoordinates(
            [
              { latitude: selectedIncident.lat, longitude: selectedIncident.lon },
              { latitude: item.lat, longitude: item.lon },
            ],
            {
              edgePadding: { top: 90, right: 60, bottom: 140, left: 60 },
              animated: true,
            }
          );
        }
      } else {
        Alert.alert("Dispatch Error", data.error || "Failed to dispatch");
      }
    } catch (e) {
      Alert.alert("Network Error", String(e));
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#111827" />

      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>🚑 SmartWay Emergency</Text>
          <Text style={styles.headerSubtitle}>Green Wave & AI Dynamic Rerouting</Text>
        </View>
        <Text style={styles.statusBadge}>{connectionStatus}</Text>
      </View>

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

      {/* Simulate Traffic Bottleneck Button */}
      {isDispatched && (
        <TouchableOpacity
          style={styles.congestionButton}
          onPress={handleSimulateCongestion}
        >
          <Text style={styles.congestionButtonText}>⚠️ Simulate Traffic Jam</Text>
        </TouchableOpacity>
      )}

      {/* Bottom Action Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[
            styles.simButton,
            isSimRunning ? styles.simButtonRunning : styles.simButtonStopped,
          ]}
          onPress={handleToggleSimulation}
        >
          <Text style={styles.simButtonText}>
            {isSimRunning ? "⏹️ Stop Simulation" : "▶️ Start Simulation"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.dispatchButton} onPress={openDispatchWizard}>
          <Text style={styles.dispatchButtonText}>🚨 Dispatch Emergency</Text>
        </TouchableOpacity>
      </View>

      {/* SINGLE UNIFIED WIZARD MODAL (Never duplicates or stacks popups) */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
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

                <FlatList
                  data={hospitals}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.locationCard, styles.hospitalCard]}
                      onPress={() => handleSelectHospital(item)}
                    >
                      <View style={[styles.locationIconWrap, { backgroundColor: '#DCFCE7' }]}>
                        <Text style={styles.locationIcon}>🏥</Text>
                      </View>
                      <View style={styles.locationTextWrap}>
                        <Text style={styles.locationName}>{item.name}</Text>
                        <Text style={styles.locationAddress}>
                          {item.address} • {item.icu_beds_available || 8} ICU Beds Available
                        </Text>
                      </View>
                      <Text style={[styles.locationSelectArrow, { color: '#16A34A' }]}>➔</Text>
                    </TouchableOpacity>
                  )}
                />

                <TouchableOpacity
                  style={styles.modalCloseButton}
                  onPress={() => setWizardStep(1)}
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
});
