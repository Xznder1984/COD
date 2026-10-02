#!/usr/bin/env python3
"""Run Operation: Urban Assault.

    npm install     (once)
    python3 run.py            single player
    python3 run.py --mp       host multiplayer
"""

import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
NPM = "npm.cmd" if os.name == "nt" else "npm"
NPX = "npx.cmd" if os.name == "nt" else "npx"
NODE = "node.exe" if os.name == "nt" else "node"
PORT = 3000
MP_PORT = 8080


def free_port(preferred):
    for port in range(preferred, preferred + 40):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.3)
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return preferred


def online(port):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=0.5).read(1)
        return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False


if not shutil.which("node"):
    sys.exit("Node.js is not installed. Get it from https://nodejs.org (18 or newer).")

# First run: install dependencies.
if not os.path.isdir(os.path.join(ROOT, "node_modules", "three")):
    print("Installing dependencies...")
    if subprocess.run([NPM, "install"], cwd=ROOT).returncode != 0:
        sys.exit("npm install failed.")

# npm 11+ blocks dependency install scripts by default. esbuild's postinstall fetches
# the binary vite runs on, so without this vite cannot start at all.
if subprocess.run([NPM, "install-scripts", "--help"],
                  cwd=ROOT, capture_output=True).returncode == 0:
    subprocess.run([NPM, "install-scripts", "approve", "--all"],
                   cwd=ROOT, capture_output=True)

port = PORT if online(PORT) else free_port(PORT)
server = None

if "--mp" in sys.argv:
    # Multiplayer serves the built client, so it needs a build first.
    if not os.path.isdir(os.path.join(ROOT, "dist")) or not os.listdir(os.path.join(ROOT, "dist")):
        print("Building the client (first time only)...")
        if subprocess.run([NPM, "run", "build"], cwd=ROOT).returncode != 0:
            sys.exit("build failed.")
    env = dict(os.environ)
    env["PORT"] = str(MP_PORT)
    print(f"Starting the multiplayer server on port {MP_PORT}...")
    server = subprocess.Popen([NODE, os.path.join(ROOT, "server", "index.js")], cwd=ROOT, env=env)
    port = MP_PORT
    for _ in range(60):
        if server.poll() is not None:
            sys.exit("the multiplayer server exited.")
        if online(port):
            break
        time.sleep(0.5)
    try:
        lan = subprocess.run(["ipconfig", "getifaddr", "en0"], capture_output=True, text=True).stdout.strip()
    except Exception:
        lan = ""
    print(f"\n  This machine:  http://localhost:{port}/")
    if lan:
        print(f"  Other devices: http://{lan}:{port}/   (share this)")
    print("\n  Choose 'Join Server' in the lobby. Up to 8 players.")
else:
    print(f"\nStarting the game on http://127.0.0.1:{port}/\n")
    server = subprocess.Popen([NPX, "vite", "--port", str(port), "--host", "127.0.0.1"], cwd=ROOT)

    for _ in range(90):
        if server.poll() is not None:
            sys.exit("vite exited. Try running `npx vite` to see why.")
        if online(port):
            break
        time.sleep(0.5)

url = f"http://127.0.0.1:{port}/"
try:
    if sys.platform == "darwin":
        subprocess.run(["open", url], capture_output=True)
    elif os.name == "nt":
        os.startfile(url)
    else:
        subprocess.run(["xdg-open", url], capture_output=True)
except Exception:
    pass

print(f"  {url}")
if "--mp" not in sys.argv:
    print("\n  WASD move · mouse look · LMB fire · RMB aim · R reload")
    print("  1-4 weapons · Shift sprint · Ctrl crouch · Space jump · P quality · Esc pause")
print("\n  Ctrl+C to stop\n")

try:
    server.wait()
except KeyboardInterrupt:
    print("\nstopping...")
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()