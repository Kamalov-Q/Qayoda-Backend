/**
 * Zoom level at which the map endpoint switches from returning centroid points
 * to returning full property outlines.
 *
 * Lives here rather than in the geo service so the query DTO can quote it in its
 * Swagger docs without importing the service that imports the DTO.
 */
export const POLYGON_ZOOM_THRESHOLD = 16;

/**
 * Sanity bounds, not architecture: negative floors are basements (the deepest
 * anywhere is around -6), and the tallest building on earth has 163 storeys.
 * They exist to stop a fat-fingered "1000" reaching the listing page.
 */
export const MIN_FLOOR = -10;
export const MAX_FLOORS = 200;

/**
 * The amenity catalog. Stored on the listing as an array of these keys; the
 * clients own the uz/ru labels, so adding a language never touches data.
 */
export const LISTING_PROPERTY_KEYS = [
  'REPAIRED',
  'FURNISHED',
  'AC',
  'HEATING',
  'PARKING',
  'GARAGE',
  'BALCONY',
  'ELEVATOR',
  'INTERNET',
  'SECURITY',
  'POOL',
  'GARDEN',
] as const;
