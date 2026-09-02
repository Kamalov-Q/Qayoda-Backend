import { PropertyCategory } from './enums/property-category.enum';

/**
 * Zoom level at which the map endpoint switches from returning centroid points
 * to returning full property outlines.
 *
 * Lives here rather than in the geo service so the query DTO can quote it in its
 * Swagger docs without importing the service that imports the DTO.
 */
export const POLYGON_ZOOM_THRESHOLD = 16;

/**
 * Categories a floor number can mean anything for. A plot of land has no
 * floors, and a `HOUSE`/`DACHA` is the whole building — "floor 2 of 5" only
 * says something when the property is one unit of a stack, or the stack itself.
 *
 * Both are still optional inside these categories: a single-storey shop-house
 * filed as `BUILDING`, or a ground-level `APARTMENT`, has no floors to give.
 * The client asks before showing the fields; nothing is inferred from a null.
 */
export const FLOOR_CAPABLE_CATEGORIES: readonly PropertyCategory[] = [
  PropertyCategory.APARTMENT,
  PropertyCategory.BUILDING,
  // A shop or office IS usually "2nd floor of something" — excluding it made
  // the floors section vanish for exactly the people who needed it.
  PropertyCategory.NON_RESIDENTIAL,
  // A hotel is a building — its floor count sells it the same way.
  PropertyCategory.HOTEL,
];

export const categoryHasFloors = (category: PropertyCategory): boolean =>
  FLOOR_CAPABLE_CATEGORIES.includes(category);

/**
 * Sanity bounds, not architecture: negative floors are basements (the deepest
 * anywhere is around -6), and the tallest building on earth has 163 storeys.
 * They exist to stop a fat-fingered "1000" reaching the listing page.
 */
export const MIN_FLOOR = -10;
export const MAX_FLOORS = 200;
