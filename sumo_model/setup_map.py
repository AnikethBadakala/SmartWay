import urllib.request
import os
import subprocess

BBOX = "78.35,17.41,78.43,17.46" # min_lon,min_lat,max_lon,max_lat (Gachibowli to Jubilee Hills roughly)
OSM_FILE = "hyderabad.osm"
NET_FILE = "hyderabad.net.xml"

url = f"https://overpass-api.de/api/map?bbox={BBOX}"

print(f"Downloading OSM data for bounding box {BBOX}...")
req = urllib.request.Request(url, headers={'User-Agent': 'SmartWay/1.0'})
with urllib.request.urlopen(req) as response, open(OSM_FILE, 'wb') as out_file:
    out_file.write(response.read())
print("Download complete.")

print("Converting to SUMO network...")
try:
    subprocess.run([
        r"C:\Users\Admin\AppData\Local\Python\pythoncore-3.14-64\Scripts\netconvert.exe", 
        "--osm-files", OSM_FILE, 
        "-o", NET_FILE,
        "--geometry.remove", "true",
        "--roundabouts.guess", "true",
        "--ramps.guess", "true",
        "--junctions.join", "true",
        "--tls.guess-signals", "true",
        "--tls.discard-simple", "true",
        "--tls.join", "true"
    ], check=True)
    print(f"Successfully generated {NET_FILE}")
except Exception as e:
    print(f"Error running netconvert: {e}")
