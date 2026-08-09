/**
 * Zoom level at which the map endpoint switches from returning centroid points
 * to returning full property outlines.
 *
 * Lives here rather than in the geo service so the query DTO can quote it in its
 * Swagger docs without importing the service that imports the DTO.
 */
export const POLYGON_ZOOM_THRESHOLD = 16;
