// package.json
{
  "name": "rsis-2.0",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "mobile": "react-native run-android"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.7.2",
    "geolib": "^3.3.3",
    "react": "18.2.0",
    "react-native": "0.73.0",
    "react-native-maps": "^1.3.2"
  }
}
npm install react-native-tts

// server.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const { calculateRiskTile } = require("./src/services/RiskEngine");
const { aggregateTile } = require("./src/services/EdgeAggregator");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

let hazardTiles = {};
src/services/TTSAudioAddon.js
// src/services/TTSAudioAddon.js
import Tts from 'react-native-tts';

const ROLE_PRIORITY = { walker: 3, cyclist: 2, vehicle: 1 };

// Optional: adjust TTS settings
Tts.setDefaultRate(0.5);
Tts.setDefaultPitch(1.0);

/**
 * Add-on function to play audio alerts for high-risk tiles
 * @param {Object} actor - {role: string}
 * @param {string} message - alert text
 */
export function playAudioAlert(actor, message) {
  const alertMessage = `[${actor.role.toUpperCase()}] ${message}`;
  Tts.speak(alertMessage);
}
import { playAudioAlert } from "./services/TTSAudioAddon";
tile.actors.forEach((actor) => {
  if (tile.riskScore > 0) {
    speakAlert(actor, "High-risk area nearby. Adjust speed and direction."); // existing console alert
    playAudioAlert(actor, "High-risk area nearby. Adjust speed and direction."); // new audio add-on
  }
});
npm run mobile

io.on("connection", (socket) => {
  console.log("IVU connected:", socket.id);

  socket.on("updateActor", (data) => {
    const tileId = `${Math.floor(data.lat*100)}_${Math.floor(data.lon*100)}`;
    if (!hazardTiles[tileId]) hazardTiles[tileId] = { actors: [], riskScore: 0 };
    hazardTiles[tileId].actors.push(data);
    hazardTiles[tileId].riskScore = calculateRiskTile(hazardTiles[tileId].actors);
    aggregateTile(tileId, hazardTiles[tileId]);
    io.emit("hazardTileUpdate", { tileId, ...hazardTiles[tileId] });
  });
});

server.listen(3000, () => console.log("RSIS Server running on port 3000"));

// src/services/RiskEngine.js
const ROLE_PRIORITY = { walker: 3, cyclist: 2, vehicle: 1 };
const TTC_THRESHOLD = 5;

function calculateTTC(actorA, actorB) {
  const dx = actorB.lat - actorA.lat;
  const dy = actorB.lon - actorA.lon;
  const dv = actorB.speed - actorA.speed;
  if (dv === 0) return Infinity;
  return Math.sqrt(dx*dx + dy*dy) / Math.abs(dv);
}

function calculateRiskTile(actors) {
  let maxRisk = 0;
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      const ttc = calculateTTC(actors[i], actors[j]);
      let risk = 0;
      if (ttc < TTC_THRESHOLD) risk = ROLE_PRIORITY[actors[i].role] + ROLE_PRIORITY[actors[j].role];
      if (risk > maxRisk) maxRisk = risk;
    }
  }
  return maxRisk;
}

module.exports = { calculateRiskTile, calculateTTC };

// src/services/TTSService.js
export function speakAlert(actor, message) {
  const priority = { walker: 3, cyclist: 2, vehicle: 1 };
  const volume = priority[actor.role] / 3;
  console.log(`[TTS-${actor.role}] ${message}`);
}

// src/services/EdgeAggregator.js
let historicalTiles = {};

export function aggregateTile(tileId, tileData) {
  if (!historicalTiles[tileId]) historicalTiles[tileId] = [];
  historicalTiles[tileId].push(tileData.riskScore);
  if (historicalTiles[tileId].length > 100) historicalTiles[tileId].shift();
  return historicalTiles[tileId];
}

// src/components/IVUMap.js
import React from "react";
import MapView, { Polygon } from "react-native-maps";

export default function IVUMap({ hazardTiles }) {
  return (
    <MapView style={{ flex: 1 }}>
      {Object.keys(hazardTiles).map((tileId) => {
        const tile = hazardTiles[tileId];
        return (
          <Polygon
            key={tileId}
            coordinates={[
              { latitude: tile.actors[0]?.lat || 0, longitude: tile.actors[0]?.lon || 0 },
              { latitude: tile.actors[0]?.lat+0.001 || 0, longitude: tile.actors[0]?.lon || 0 },
              { latitude: tile.actors[0]?.lat+0.001 || 0, longitude: tile.actors[0]?.lon+0.001 || 0 },
              { latitude: tile.actors[0]?.lat || 0, longitude: tile.actors[0]?.lon+0.001 || 0 }
            ]}
            fillColor={`rgba(255,0,0,${tile.riskScore/5})`}
          />
        );
      })}
    </MapView>
  );
}

// src/components/ActorList.js
import React from "react";
import { FlatList, Text, View } from "react-native";

export default function ActorList({ actors }) {
  return (
    <FlatList
      data={actors}
      keyExtractor={(item, index) => index.toString()}
      renderItem={({ item }) => (
        <View>
          <Text>{`${item.role.toUpperCase()}: ${item.speed} m/s`}</Text>
        </View>
      )}
    />
  );
}

// src/App.js
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import io from "socket.io-client";
import IVUMap from "./components/IVUMap";
import { speakAlert } from "./services/TTSService";

export default function App() {
  const [hazardTiles, setHazardTiles] = useState({});
  const socket = io("http://localhost:3000");

  useEffect(() => {
    socket.on("hazardTileUpdate", (tile) => {
      setHazardTiles((prev) => ({ ...prev, [tile.tileId]: tile }));
      tile.actors.forEach((actor) => {
        if (tile.riskScore > 0) speakAlert(actor, "High-risk area nearby. Adjust speed and direction.");
      });
    });
  }, []);

  return <View style={{ flex: 1 }}><IVUMap hazardTiles={hazardTiles} /></View>;
}
