import React from 'react';
import { View, StyleSheet } from 'react-native';

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

export default function SmartMap({ leafletHtml, style }: SmartMapProps) {
  return (
    <View style={[styles.container, style]}>
      {/* @ts-ignore */}
      <iframe
        srcDoc={leafletHtml}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="SmartWay Live Map"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
});
