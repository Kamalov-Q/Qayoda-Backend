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

