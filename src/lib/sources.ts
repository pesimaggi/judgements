export interface SourceDef {
  key: string;
  name: string;
  officialBaseUrl: string;
}

/** The three Icelandic courts published on island.is/domar. */
export const SOURCES: SourceDef[] = [
  { key: "haestirettur", name: "Hæstiréttur Íslands", officialBaseUrl: "https://island.is/domar" },
  { key: "landsrettur", name: "Landsréttur", officialBaseUrl: "https://island.is/domar" },
  { key: "heradsdomar", name: "Héraðsdómar", officialBaseUrl: "https://island.is/domar" },
];

export const SOURCE_KEYS = new Set(SOURCES.map((s) => s.key));

export function sourceByKey(key: string): SourceDef | undefined {
  return SOURCES.find((s) => s.key === key);
}
