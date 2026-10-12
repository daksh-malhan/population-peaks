import type { BBox, MultiPolygon } from '../geo/geomCodec';

export type LngLat = [lng: number, lat: number];

export type RegionShape =
  | { kind: 'polygons'; polygons: MultiPolygon }
  | { kind: 'circle'; lng: number; lat: number; radiusKm: number };

export interface RegionRequest {
  /** Unwrapped bounds of the place (east may exceed 180 for antimeridian regions). */
  bbox: BBox;
  shape: RegionShape;
  /** Outline of a tiny place drawn inside its context circle; stats are measured over it. */
  highlight?: MultiPolygon;
  /** Long side of the output grid, in cells. */
  targetCells: number;
  maxZoom?: number;
}

export interface RegionStats {
  population: number;
  peakDensity: number;
  peak: LngLat;
}

export interface RegionGrid {
  width: number;
  height: number;
  cellKm: number;
  /** Centre of the equal-area projection the grid is laid out in. */
  center: LngLat;
  /** Projected km of the grid's top-left corner (x west edge, y north edge). */
  originKm: [number, number];
  /** Smoothed people/km² per cell, row-major, north row first. */
  density: Float32Array;
  /** Coverage 0..1 of the region's shape. */
  mask: Float32Array;
  highlight?: Float32Array;
  zoom: number;
  stats: RegionStats;
}
