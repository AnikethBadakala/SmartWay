import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';

let WebView: any = null;
if (Platform.OS === 'android') {
  try {
    WebView = require('react-native-webview').WebView;
  } catch (e) {}
}

export interface SmartMapProps {
  leafletHtml: string;
  ambulance?: any;
  incidents?: any[];
  selectedIncident?: any;
  hospitals?: any[];
  selectedHospital?: any;
  signals?: any[];
  optimalRoute?: any[];
  altRoute1?: any[];
  altRoute2?: any[];
  isDispatched?: boolean;
  mapRef?: any;
  style?: any;
  ambulanceSpeed?: number;
}

export default function SmartMap(props: SmartMapProps) {
  const {
    leafletHtml,
    ambulance,
    incidents = [],
    selectedIncident,
    hospitals = [],
    selectedHospital,
    signals = [],
    optimalRoute = [],
    altRoute1 = [],
    altRoute2 = [],
    isDispatched = false,
    mapRef,
    style,
    ambulanceSpeed = 0,
  } = props;

  // On Android, render Leaflet inside WebView (zero Google Maps crashes, $0 cost)
  if (Platform.OS === 'android' && WebView) {
    return (
      <WebView
        source={{ html: leafletHtml }}
        style={[styles.container, style]}
        originWhitelist={['*']}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowFileAccess={true}
        mixedContentMode="always"
      />
    );
  }

  // On iOS (or fallback), render native Apple Maps (MapKit, zero keys needed, never crashes)
  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_DEFAULT}
      style={[styles.container, style]}
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
            title={`?? ${inc.name}`}
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
          title={`?? Pickup: ${selectedIncident.name}`}
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
          title={`?? Destination: ${selectedHospital.name}`}
          pinColor="green"
        />
      ) : (
        hospitals.map((hosp) => (
          <Marker
            key={`hosp_${hosp.id}`}
            coordinate={{ latitude: hosp.lat, longitude: hosp.lon }}
            title={`?? ${hosp.name}`}
            pinColor="green"
          />
        ))
      )}

      {/* Traffic Signals */}
      {signals.map((tls) => {
        const isGreen = tls.state === 'GREEN';
        return (
          <Marker
            key={`tls_${tls.id}`}
            coordinate={{ latitude: tls.lat, longitude: tls.lon }}
            title={`?? ${tls.name}`}
            description={
              isGreen
                ? '?? GREEN — Cleared for Ambulance'
                : '?? RED — Normal Traffic Stop'
            }
            pinColor={isGreen ? '#10B981' : '#EF4444'}
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
          title="?? Emergency Ambulance"
          description={`Speed: ${ambulanceSpeed} km/h`}
          pinColor="blue"
          zIndex={20}
        />
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});
