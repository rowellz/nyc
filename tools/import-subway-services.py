"""Bundle normal MTA services and per-direction geometry for offline sign matching.

python tools/import-subway-services.py /path/to/gtfs_subway.zip /path/to/stations.json
Stations: https://data.ny.gov/resource/39hk-dx4f.json?$limit=1000
GTFS: https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip
"""
import csv
import hashlib
import io
import json
import pathlib
import sys
import zipfile
from collections import defaultdict, Counter

archive, catalog = map(pathlib.Path, sys.argv[1:3])
with zipfile.ZipFile(archive) as feed:
    def rows(name):
        return list(csv.DictReader(io.TextIOWrapper(feed.open(name), encoding='utf-8-sig')))
    routes = {r['route_id']: {'label': r['route_short_name'], 'name': r['route_long_name'],
                             'color': '#'+r['route_color'], 'text': '#'+r['route_text_color']}
              for r in rows('routes.txt')}
    shapes = defaultdict(list)
    for p in rows('shapes.txt'):
        shapes[p['shape_id']].append((int(p['shape_pt_sequence']), float(p['shape_pt_lon']), float(p['shape_pt_lat'])))
    shapes = {k: [p[1:] for p in sorted(v)] for k,v in shapes.items()}
    trips = {t['trip_id']: t for t in rows('trips.txt')}
    # Count normal weekday daytime patterns, excluding overnight/rush-only extras.
    patterns = defaultdict(lambda: defaultdict(int))
    for stop in rows('stop_times.txt'):
        t = trips[stop['trip_id']]
        hour = int(stop['arrival_time'].split(':')[0])
        if t['service_id'] != 'Weekday' or not 10 <= hour < 16:
            continue
        patterns[stop['stop_id']][(t['route_id'], t['shape_id'], t['trip_headsign'])] += 1
    trip_patterns = defaultdict(Counter)
    for t in trips.values():
        trip_patterns[(t['route_id'], t['direction_id'])][(t['shape_id'], t['trip_headsign'])] += 1
    stations = []
    for s in json.loads(catalog.read_text()):
        lon, lat = float(s['gtfs_longitude']), float(s['gtfs_latitude'])
        if not -74.04 < lon < -73.895 or not 40.67 < lat < 40.89:
            continue
        item = {k:s[k] for k in ['station_id','gtfs_stop_id','stop_name','line','borough','daytime_routes','north_direction_label','south_direction_label']}
        item.update(lon=lon,lat=lat,directions={})
        for direction in ['N','S']:
            services = []
            by_route = defaultdict(list)
            for (rid,shape,headsign),count in patterns[s['gtfs_stop_id']+direction].items():
                by_route[rid].append((count,shape,headsign))
            for published_id in s['daytime_routes'].split():
                rid = published_id
                if rid == 'S':
                    rid = 'GS' if s['line'] == 'Lexington - Shuttle' else 'FS'
                if by_route[rid]:
                    _,shape,headsign = max(by_route[rid])
                else:
                    # Station catalog describes normal service even when a
                    # long-term GTFS supplement omits a stop for construction.
                    candidates = trip_patterns[(rid, '0' if direction == 'N' else '1')]
                    if not candidates:
                        raise ValueError(f'No direction geometry for {rid} at {s["stop_name"]}')
                    shape,headsign = candidates.most_common(1)[0][0]
                points = shapes[shape]
                i = min(range(len(points)), key=lambda i:(points[i][0]-lon)**2*.575+(points[i][1]-lat)**2)
                a,b = points[max(0,i-2)],points[min(len(points)-1,i+2)]
                services.append({'route':rid,'headsign':headsign,'vector':[b[0]-a[0], b[1]-a[1]]})
            item['directions'][direction] = services
        stations.append(item)
    result = {'source':'https://www.mta.info/developers',
              'stationSource':'https://data.ny.gov/Transportation/MTA-Subway-Stations/39hk-dx4f',
              'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
              'stationSha256':hashlib.sha256(catalog.read_bytes()).hexdigest(),
              'feed':rows('feed_info.txt'), 'routes':routes, 'stations':stations}
target = pathlib.Path(__file__).resolve().parents[1]/'web/static/world/assets/rail/subway-services.json'
target.write_text(json.dumps(result,separators=(',',':'))+'\n')
print(f'Bundled {len(stations)} MTA stations, {len(routes)} services')
