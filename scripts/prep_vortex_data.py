#!/usr/bin/env python
"""Prepare ERA5 10 hPa winds for the website's polar vortex animation.

Reads monthly ERA5 files named like u.10hPa.6hr.ERA5.YYYY-MM.nc (and the
matching v files), averages them to daily (or another interval), reprojects
the Northern Hemisphere onto a north-polar stereographic grid, rotates the
winds into screen coordinates, and writes two small files:

    meta.json   grid size, dates, and scaling the website needs
    winds.bin   int8 wind components, shape (frames, size, size, 2)

Copy both into the website repo at data/vortex/.

Example:
    python prep_vortex_data.py --start 2020-12-01 --end 2021-03-15

Needs numpy, pandas, xarray, scipy and netCDF4.
"""
import argparse
import json
import pathlib

import numpy as np
import pandas as pd
import xarray as xr
from scipy.ndimage import map_coordinates

ERA5 = "/home/hollythomas/REPO/reanalysis/ERA5/6hourly"


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--u-dir", default=f"{ERA5}/u/u10", help="folder with u.10hPa.6hr.ERA5.YYYY-MM.nc files")
    p.add_argument("--v-dir", default=f"{ERA5}/v/v10", help="folder with v.10hPa.6hr.ERA5.YYYY-MM.nc files")
    p.add_argument("--pattern", default="{var}.10hPa.6hr.ERA5.{ym}.nc", help="file name pattern")
    p.add_argument("--start", default="2020-12-01", help="first day (YYYY-MM-DD)")
    p.add_argument("--end", default="2021-03-15", help="last day (YYYY-MM-DD)")
    p.add_argument("--hours", type=int, default=24, help="hours per animation frame (24 = daily means, 6 = every time step)")
    p.add_argument("--lat-min", type=float, default=30.0, help="southern edge of the map, degrees N")
    p.add_argument("--size", type=int, default=128, help="output grid is size x size")
    p.add_argument("--scale", type=float, default=0.8, help="m/s per stored unit; int8 then covers about +/-100 m/s")
    p.add_argument("--out", default="vortex-data", help="output folder")
    return p.parse_args()


def standardize(da):
    """Make old- and new-style (post-2024 CDS) ERA5 netCDF look the same.

    New-style files call the time axis valid_time, add a length-1
    pressure_level dimension, and carry extra coordinates (number, expver).
    """
    rename = {"valid_time": "time", "lat": "latitude", "lon": "longitude"}
    da = da.rename({k: v for k, v in rename.items() if k in da.dims or k in da.coords})
    for dim in list(da.dims):
        if dim not in ("time", "latitude", "longitude"):
            da = da.isel({dim: 0})
    return da.reset_coords(drop=True)


def load(var, folder, args):
    """Load one variable for the date range, north of lat_min, averaged to args.hours."""
    months = pd.period_range(args.start, args.end, freq="M")
    files = [pathlib.Path(folder) / args.pattern.format(var=var, ym=m.strftime("%Y-%m")) for m in months]
    missing = [str(f) for f in files if not f.exists()]
    if missing:
        raise SystemExit(f"Missing {var} files:\n  " + "\n  ".join(missing))

    pieces = []
    for f in files:
        with xr.open_dataset(f) as ds:
            da = standardize(ds[var]).sortby("latitude").sel(latitude=slice(args.lat_min - 1, 90))
            da = da.sel(time=slice(args.start, pd.Timestamp(args.end) + pd.Timedelta(hours=23)))
            if da.sizes["time"]:
                pieces.append(da.resample(time=f"{args.hours}h").mean().load())
        print(f"  read {f.name}")
    return xr.concat(pieces, "time").sortby("longitude")


def polar_grid(size, lat_min):
    """Lat/lon of each output pixel. Screen x points right, y points down, Greenwich at the bottom."""
    c = np.linspace(-1, 1, size)
    x, y = np.meshgrid(c, c)
    r = np.hypot(x, y)
    t = np.tan(np.radians(90 - lat_min) / 2)
    colat = 2 * np.arctan(r * t)
    lat = 90 - np.degrees(colat)
    lon = np.degrees(np.arctan2(x, y)) % 360
    return lat, lon, colat, r <= 1


def main():
    args = parse_args()
    print("Loading u ...")
    u = load("u", args.u_dir, args)
    print("Loading v ...")
    v = load("v", args.v_dir, args)
    u, v = xr.align(u, v, join="inner")
    if not u.sizes["time"]:
        raise SystemExit("No time steps in the requested range.")

    lat, lon, colat, inside = polar_grid(args.size, args.lat_min)

    # Fractional array indices of each pixel; longitude wraps around.
    lats, lons = u.latitude.values, u.longitude.values
    i_lat = np.interp(lat, lats, np.arange(lats.size))
    dlon = lons[1] - lons[0]
    i_lon = ((lon - lons[0]) % 360) / dlon
    coords = np.array([i_lat.ravel(), i_lon.ravel()])

    # Unit vectors on screen: east is counter-clockwise, north points to the centre.
    lam = np.radians(lon)
    mapfac = 1 / np.cos(colat / 2) ** 2  # stereographic stretch, so particles move at true map speed

    frames = []
    for k in range(u.sizes["time"]):
        uu = np.nan_to_num(np.concatenate([u.values[k], u.values[k][:, :1]], axis=1))
        vv = np.nan_to_num(np.concatenate([v.values[k], v.values[k][:, :1]], axis=1))
        ui = map_coordinates(uu, coords, order=1, mode="nearest").reshape(lat.shape)
        vi = map_coordinates(vv, coords, order=1, mode="nearest").reshape(lat.shape)
        sx = (ui * np.cos(lam) - vi * np.sin(lam)) * mapfac
        sy = (-ui * np.sin(lam) - vi * np.cos(lam)) * mapfac
        frame = np.stack([sx, sy], axis=-1)
        frame[~inside] = 0
        frames.append(frame)

    data = np.array(frames)
    q = np.clip(np.round(data / args.scale), -127, 127).astype(np.int8)

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    q.tofile(out / "winds.bin")
    dates = [pd.Timestamp(t).strftime("%Y-%m-%dT%H:%M") for t in u.time.values]
    meta = {
        "size": args.size,
        "frames": len(dates),
        "latMin": args.lat_min,
        "scale": args.scale,
        "hours": args.hours,
        "dates": dates,
        "source": "ERA5 10 hPa winds",
    }
    (out / "meta.json").write_text(json.dumps(meta))

    speed = np.hypot(data[..., 0], data[..., 1])[:, inside]
    print(f"\nWrote {len(dates)} frames ({dates[0]} to {dates[-1]}) to {out}/")
    print(f"  winds.bin {q.nbytes / 1e6:.1f} MB, max map speed {speed.max():.0f} m/s,"
          f" {np.mean(np.abs(data) > 127 * args.scale) * 100:.2f}% of values clipped")


if __name__ == "__main__":
    main()
