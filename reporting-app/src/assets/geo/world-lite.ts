/**
 * A DELIBERATELY MINIMAL world map: rough rectangles for the demo project's countries,
 * keyed by ISO-3166-1 alpha-2 so it lines up with the `country` dimension.
 *
 * This is a placeholder so the choropleth renders in development without shipping a
 * multi-hundred-KB GeoJSON in the bundle. For production, replace this module with a real
 * boundaries GeoJSON (e.g. Natural Earth / world-atlas) — the renderer registers whatever
 * this module default-exports, so nothing else changes. The renderer surfaces any region
 * code with no matching feature as a tile warning rather than dropping it silently.
 */
type Feature = {
  type: 'Feature';
  properties: { name: string };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
};

const box = (name: string, x: number, y: number, w = 6, h = 5): Feature => ({
  type: 'Feature',
  properties: { name },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
        [x, y],
      ],
    ],
  },
});

/** name === the alpha-2 code, which is what the region values are. */
const geoJson = {
  type: 'FeatureCollection' as const,
  features: [
    box('US', -110, 35, 24, 12),
    box('CA', -110, 50, 24, 10),
    box('GB', -3, 52, 4, 4),
    box('FR', 2, 46, 5, 5),
    box('DE', 9, 50, 5, 5),
    box('NL', 4, 52, 3, 2),
    box('ES', -4, 39, 6, 5),
    box('DK', 9, 55, 3, 2),
    box('IT', 11, 42, 4, 6),
  ],
};

export default geoJson;
export const MAP_NAME = 'world-lite';
