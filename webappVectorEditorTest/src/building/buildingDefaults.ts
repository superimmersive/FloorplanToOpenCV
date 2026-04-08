/**
 * Nominal vertical dimensions (mm) for 3D export (e.g. Blender) and layer defaults.
 * Plan view stays 2D; these drive extrusion and opening heights.
 *
 * Vertical datum: z = 0 is ground. Foundation slab occupies [0, foundationHeightMm].
 * Walls, doors, and windows use layer z = foundation top + nominal sill (finished floor).
 */

/** Foundation / slab thickness (mm); walls and openings sit on top of this. */
export const DEFAULT_FOUNDATION_HEIGHT_MM = 200;

/** Storey wall height — typical residential (2.4 m). */
export const DEFAULT_WALL_HEIGHT_MM = 2400;

/**
 * Finished floor extrusion in mm for 3D export. Zero = flat plane flush with foundation top.
 */
export const DEFAULT_FLOOR_THICKNESS_MM = 0;

/**
 * Ceiling extrusion in mm for 3D export. Zero = flat plane (no slab thickness) for now;
 * a future multi-storey model may use a positive value for inter-floor slabs.
 */
export const DEFAULT_CEILING_THICKNESS_MM = 0;

/** Standard window opening height until per-window data exists in the editor. */
export const DEFAULT_WINDOW_HEIGHT_MM = 1200;

/**
 * Distance from finished floor (top of foundation slab) to the bottom of the window opening (mm).
 * Typical residential sill ~900 mm; used for 3D export / Blender.
 */
export const DEFAULT_WINDOW_SILL_HEIGHT_MM = 900;

/** Doors are treated as opening from floor; bottom of door opening in mm. */
export const DEFAULT_DOOR_SILL_HEIGHT_MM = 0;

/** Plan depth (mm) from inner wall face into the room for skirting strip footprint. */
export const DEFAULT_SKIRTING_DEPTH_MM = 25;

/** Floor skirting — vertical height above finished floor (mm). */
export const DEFAULT_FLOOR_SKIRTING_HEIGHT_MM = 80;

/** Ceiling skirting / coving — vertical extent below ceiling plane (mm). */
export const DEFAULT_CEILING_SKIRTING_HEIGHT_MM = 80;
