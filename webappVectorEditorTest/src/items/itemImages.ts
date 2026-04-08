import singleDoorUrl from "../../ItemsUI/singleDoor.svg";

/** Vite-resolved URL for each catalog item id that uses an image (SVG/PNG) instead of flat fill. */
export const ITEM_IMAGE_URL_BY_ID: Partial<Record<string, string>> = {
  "single-door": singleDoorUrl,
};

export function getItemImageUrl(itemId: string | undefined): string | undefined {
  if (!itemId) return undefined;
  return ITEM_IMAGE_URL_BY_ID[itemId];
}

export const ALL_ITEM_IMAGE_URLS: string[] = [
  ...new Set(Object.values(ITEM_IMAGE_URL_BY_ID).filter((u): u is string => typeof u === "string")),
];
