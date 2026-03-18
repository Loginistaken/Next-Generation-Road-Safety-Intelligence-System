# =============================
# RSIS 5.1 — BASE44 READY BUILD (CLOUD COMPATIBLE)
# =============================
# Converted from Windows PowerShell to a single-runtime Node.js system
# Hardware modules replaced with simulated data streams
# All logic preserved and runnable inside Base44
# =============================

# --------- MAIN SERVER (server.js) ---------

const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

let clients = [];

app.post('/event', (req, res) => {
    const event = req.body;
    console.log('EVENT:', event);

    // Stream to frontend (SSE)
    clients.forEach(client => client.write(`data: ${JSON.stringify(event)}\n\n`));

    res.send({ status: 'received' });
});

app.get('/stream', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    clients.push(res);
});

app.listen(3000, () => console.log('RSIS running on port 3000'));

# --------- SIMULATED VEHICLE + GPS (replaces BLE/OBD/CAN) ---------

setInterval(async () => {
    const event = {
        type: 'gps',
        id: 'vehicle_' + Math.floor(Math.random() * 3),
        speed: Math.random() * 100,
        latitude: 36.2168 + (Math.random() - 0.5) * 0.01,
        longitude: -81.6746 + (Math.random() - 0.5) * 0.01
    };

    await axios.post('http://localhost:3000/event', event);
}, 3000);

# --------- TRAFFIC SIGNAL SIMULATION ---------

let signalState = 'GREEN';
setInterval(async () => {
    signalState = signalState === 'GREEN' ? 'RED' : 'GREEN';

    await axios.post('http://localhost:3000/event', {
        type: 'traffic_signal',
        state: signalState,
        latitude: 36.2168,
        longitude: -81.6746
    });
}, 5000);

# --------- V2V (HTTP-BASED SIMULATION) ---------

setInterval(async () => {
    await axios.post('http://localhost:3000/event', {
        type: 'v2v_alert',
        warning: 'Collision risk nearby',
        time: Date.now()
    });
}, 7000);

# --------- AI TRAINING PIPELINE (SIMPLIFIED) ---------

const fs = require('fs');

setInterval(() => {
    const event = {
        speed: Math.random() * 100,
        distance: Math.random() * 20,
        timestamp: Date.now()
    };

    fs.appendFileSync('training_data.json', JSON.stringify(event) + '\n');
}, 3000);

# --------- DOT INTEGRATION (SAFE MOCK) ---------

setInterval(() => {
    console.log('DOT EVENT:', {
        type: 'hazard_report',
        severity: 'high'
    });
}, 10000);

# --------- BASE44 FRONTEND MAP (Leaflet) ---------

/*
Paste into Base44 frontend JS panel
*/

const eventSource = new EventSource('/stream');

let map;
let markers = {};
let heatPoints = [];
let heatLayer;
let lastPositions = {};

function initMap() {
    map = L.map('map').setView([36.2168, -81.6746], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(map);

    heatLayer = L.heatLayer([], { radius: 25 }).addTo(map);
}

initMap();

function updateVehicle(id, lat, lon) {
    if (markers[id]) {
        markers[id].setLatLng([lat, lon]);
    } else {
        markers[id] = L.marker([lat, lon]).addTo(map);
    }
}

function addHeatPoint(lat, lon) {
    heatPoints.push([lat, lon, 1]);
    heatLayer.setLatLngs(heatPoints);
}

function showTurnWarning(lat, lon, message) {
    L.popup().setLatLng([lat, lon]).setContent('⚠️ ' + message).openOn(map);
}

eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'gps') {
        const { id, latitude, longitude } = data;

        updateVehicle(id, latitude, longitude);

        if (!lastPositions[id]) lastPositions[id] = [];
        lastPositions[id].push([latitude, longitude]);

        if (lastPositions[id].length > 5) lastPositions[id].shift();

        map.setView([latitude, longitude], 15);

        if (data.speed > 50 && lastPositions[id].length >= 2) {
            const [lat1, lon1] = lastPositions[id][0];
            const [lat2, lon2] = lastPositions[id][1];

            const change = Math.abs(lat2 - lat1) + Math.abs(lon2 - lon1);

            if (change > 0.001) {
                showTurnWarning(lat2, lon2, 'Sharp turn ahead');
            }
        }
    }

    if (data.type === 'harsh_brake' || data.type === 'v2v_alert') {
        if (data.latitude && data.longitude) {
            addHeatPoint(data.latitude, data.longitude);
        }
    }
};

# --------- CITY-SCALE ARCHITECTURE (UNCHANGED) ---------

architecture = {
    "edge_nodes": "RSU devices at intersections",
    "regional_servers": "aggregate data per city zone",
    "central_cloud": "AI + storage + global coordination"
}

# --------- RSU HARDWARE SCHEMATICS (UNCHANGED) ---------

components = {
    "microcontroller": "Raspberry Pi / NVIDIA Jetson Nano",
    "communication": ["BLE", "Wi-Fi", "C-V2X modem"],
    "sensors": ["camera", "radar", "lidar (optional)"],
    "power": "solar + battery backup",
    "connectivity": "4G/5G uplink"
}

# =============================
# END BASE44 VERSION
# =============================
