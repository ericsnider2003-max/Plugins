#!/usr/bin/env python3
"""Build the two files you hand to a person: the desktop kit and the plugin-only zip for 'Upload local plugin'.
   python3 install/build-kit.py --out <dir>      (run from anywhere inside the repo; uses only tracked files)"""
import argparse, json, os, subprocess, sys, zipfile

repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
ver = json.load(open(os.path.join(repo, 'usage-max/.claude-plugin/plugin.json')))['version']
tracked = subprocess.check_output(['git', '-C', repo, 'ls-files', 'usage-max'], text=True).split('\n')
SKIP = ('usage-max/test/', 'usage-max/codex/test/')
plugin_files = [f for f in tracked if f and not f.startswith(SKIP)]

def add(z, arc, data, mode=0o644):
    zi = zipfile.ZipInfo(arc, date_time=(2026, 10, 10, 0, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED; zi.external_attr = (mode & 0xFFFF) << 16
    z.writestr(zi, data)

# 1) plugin-only zip: one top-level folder "usage-max/" holding .claude-plugin/plugin.json (the shape the upload dialog accepts)
plugin_zip = os.path.join(a.out, f'usage-max-plugin-{ver}.zip')
with zipfile.ZipFile(plugin_zip, 'w') as z:
    for f in plugin_files: add(z, f, open(os.path.join(repo, f), 'rb').read(), 0o755 if f.endswith('.sh') else 0o644)

# 2) desktop kit: launchers (CRLF for Windows files), START-HERE, the plugin folder, and the plugin zip
kit_zip = os.path.join(a.out, 'usage-max-desktop.zip')
kit_dir = os.path.join(repo, 'install/kit')
with zipfile.ZipFile(kit_zip, 'w') as z:
    for n in sorted(os.listdir(kit_dir)):
        raw = open(os.path.join(kit_dir, n), 'rb').read().replace(b'@VERSION@', ver.encode())
        win = n.endswith('.cmd') or n.endswith('.txt')
        add(z, f'usage-max-desktop/{n}', raw.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n') if win else raw.replace(b'\r\n', b'\n'), 0o644 if win else 0o755)  # .sh must be LF whatever the checkout did
    for f in plugin_files: add(z, f'usage-max-desktop/{f}', open(os.path.join(repo, f), 'rb').read())
    add(z, f'usage-max-desktop/usage-max-plugin-{ver}.zip', open(plugin_zip, 'rb').read())
print(f'built {plugin_zip} ({os.path.getsize(plugin_zip)} bytes) and {kit_zip} ({os.path.getsize(kit_zip)} bytes) for version {ver}')
