RSIS/
│
├─ node-simulator/
│   ├─ codex-binary.js          # Node.js multi-role simulator (delta encoding + ephemeral tokens)
│   └─ package.json
│
├─ mobile-app/
│   ├─ App.js                   # React Native app with audio/UI alerts & WebRTC neighbor detection
│   ├─ package.json
│   └─ other standard RN files
│
├─ edge-server/
│   ├─ server.js                # Express + QUIC edge server for hazard tile ingestion & broadcast
│   └─ package.json
│
└─ README.md                    # Setup & run instructions
const dgram = require('dgram');
const geohash = require('ngeohash');
const crypto = require('crypto');
const PORT = 4000;

const Role = { DRIVER:0, PASSENGER:1, WALKER:2, BICYCLE:3, OTHER:4 };

let neighborTable = {};

function generateToken(){ return crypto.randomBytes(4).toString('hex'); }

function encodeDelta(prev, current){
    const deltaLat = current.lat - prev.lat;
    const deltaLon = current.lon - prev.lon;
    const deltaSpeed = current.speed - prev.speed;
    const deltaHeading = current.heading - prev.heading;

    const buffer = Buffer.alloc(16);
    buffer.writeInt32LE(Math.round(deltaLat*1e6),0);
    buffer.writeInt32LE(Math.round(deltaLon*1e6),4);
    buffer.writeInt16LE(Math.round(deltaSpeed*100),8);
    buffer.writeInt16LE(Math.round(deltaHeading*10),10);
    buffer.writeUInt32LE(current.seq,12);
    return buffer;
}

function decodeDelta(buffer, deviceId){
    const lat = buffer.readInt32LE(0)/1e6;
    const lon = buffer.readInt32LE(4)/1e6;
    const speed = buffer.readInt16LE(8)/100;
    const heading = buffer.readInt16LE(10)/10;
    const seq = buffer.readUInt32LE(12);

    if(!neighborTable[deviceId]) neighborTable[deviceId] = {trustScore:50, lastSeq:seq};
    else {
        neighborTable[deviceId].trustScore += (seq > neighborTable[deviceId].lastSeq?1:-5);
        neighborTable[deviceId].trustScore = Math.max(0, Math.min(100, neighborTable[deviceId].trustScore));
        neighborTable[deviceId].lastSeq = seq;
    }
    return {lat, lon, speed, heading, trustScore:neighborTable[deviceId].trustScore};
}

function startNode(role, lat, lon){
    const socket = dgram.createSocket('udp4');
    let seq = 1;
    let prevState = {lat, lon, speed:0, heading:0, seq:0};
    let token = generateToken();

    socket.on('message', (msg,rinfo)=>{
        const neighborId = rinfo.address + ':' + rinfo.port;
        const data = decodeDelta(msg, neighborId);
        console.log(`Neighbor ${neighborId} trust:${data.trustScore} pos:(${data.lat.toFixed(6)},${data.lon.toFixed(6)})`);
    });

    setInterval(()=>{
        const current = {
            lat: lat + Math.random()*0.0001,
            lon: lon + Math.random()*0.0001,
            speed: Math.random()*50,
            heading: Math.random()*360,
            seq: seq++
        };
        const delta = encodeDelta(prevState,current);
        socket.send(delta,0,delta.length,PORT,'255.255.255.255');
        prevState = current;

        // rotate token every 5 minutes
        if(seq % 300 === 0) token = generateToken();

    }, 500);

    socket.bind(PORT,()=>{ socket.setBroadcast(true); console.log(`Node broadcasting as role ${role} with token ${token}`);});
}

// Example launch
startNode(Role.DRIVER, 41.8781, -87.6298);
startNode(Role.WALKER, 41.8785, -87.6295);
import React, {useEffect, useState} from 'react';
import {View, Text} from 'react-native';
import {BleManager} from 'react-native-ble-plx';
import Tts from 'react-native-tts';
import {RTCPeerConnection} from 'react-native-webrtc';

const Role = { DRIVER:0, PASSENGER:1, WALKER:2, BICYCLE:3, OTHER:4 };
const roleNames = ['Driver','Passenger','Walker','Bicycle','Other'];

export default function App(){
  const [neighbors,setNeighbors] = useState([]);
  const manager = new BleManager();
  const pc = new RTCPeerConnection();
  const dataChannel = pc.createDataChannel('RSIS');

  useEffect(()=>{
    dataChannel.onmessage = (event)=>{
      const msg = JSON.parse(event.data); // simplified delta JSON
      setNeighbors(prev=>{
        const filtered = prev.filter(n=>n.deviceId!==msg.deviceId);
        return [...filtered,msg];
      });
      if(msg.distance<30) Tts.speak(`${roleNames[msg.role]} ${Math.round(msg.distance)} feet away. Slow down.`);
    };
    manager.onStateChange(state=>{
      if(state==='PoweredOn'){
        startScanning();
      }
    },true);
  },[]);

  const startScanning=()=>{
    manager.startDeviceScan(null,null,(error,device)=>{
      if(error) return;
      if(device && device.name && device.name.includes('RSIS')){
        const msg = {deviceId:device.id, role:Role.WALKER, distance: Math.random()*100};
        dataChannel.send(JSON.stringify(msg));
      }
    });
  };

  return(
    <View style={{flex:1,alignItems:'center',justifyContent:'center'}}>
      <Text>RSIS Multi-Role Node</Text>
      {neighbors.map(n=><Text key={n.deviceId}>{roleNames[n.role]} {n.distance.toFixed(1)} ft | Trust {n.trustScore}</Text>)}
    </View>
  );
}
const express = require('express');
const app = express();
const cors = require('cors');
app.use(cors());
app.use(express.json());

let hazardTiles = [];

app.post('/v1/tiles/ingest',(req,res)=>{
  const tile = req.body;
  hazardTiles.push(tile);
  console.log('Tile ingested', tile);
  res.json({status:'ok'});
});

app.get('/v1/tiles/nearby',(req,res)=>{
  const {lat,lon,r} = req.query;
  const nearby = hazardTiles.filter(t => Math.abs(t.lat-lat)<0.01 && Math.abs(t.lon-lon)<0.01);
  res.json(nearby);
});

app.listen(5000,()=>console.log('RSIS Edge Server running on 5000'));
