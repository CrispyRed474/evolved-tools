#!/usr/bin/env python3
"""
Evolved Floors — Floor Visualiser WebSocket Relay
Run this on the showroom PC. Keeps display and remote in sync.

Usage: python3 floor-server.py
Then open http://localhost:8080/floor-display.html on the projector PC
Open http://[PC-IP]:8080/floor-remote.html on the tablet
"""

import asyncio
import websockets
import http.server
import threading
import os
import json

PORT_WS = 8765
PORT_HTTP = 8080

connected = set()

async def relay(websocket):
    connected.add(websocket)
    print(f"[+] Client connected. Total: {len(connected)}")
    try:
        async for message in websocket:
            print(f"[→] Relaying: {message}")
            # Broadcast to all other connected clients
            others = {c for c in connected if c != websocket}
            if others:
                await asyncio.gather(*[c.send(message) for c in others], return_exceptions=True)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected.discard(websocket)
        print(f"[-] Client disconnected. Total: {len(connected)}")

def start_http():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    handler = http.server.SimpleHTTPRequestHandler
    httpd = http.server.HTTPServer(('0.0.0.0', PORT_HTTP), handler)
    print(f"[HTTP] Serving on http://0.0.0.0:{PORT_HTTP}")
    httpd.serve_forever()

async def main():
    # Start HTTP server in background thread
    t = threading.Thread(target=start_http, daemon=True)
    t.start()

    # Start WebSocket server
    print(f"[WS] WebSocket relay on ws://0.0.0.0:{PORT_WS}")
    print(f"\n{'='*50}")
    print("SETUP:")
    print(f"  Projector display: http://localhost:{PORT_HTTP}/floor-display.html")
    print(f"  Tablet remote:     http://[THIS-PC-IP]:{PORT_HTTP}/floor-remote.html")
    print(f"  Find your IP:      ipconfig (Windows) / ifconfig (Mac)")
    print(f"{'='*50}\n")

    async with websockets.serve(relay, '0.0.0.0', PORT_WS):
        await asyncio.Future()  # run forever

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[!] Server stopped.")
