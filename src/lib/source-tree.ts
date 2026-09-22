/**
 * The hierarchy the Heimildir panel renders.
 *
 * It does NOT replace src/lib/sources.ts — every entry here is an existing
 * `SourceDef.key`, and the `sources` field of a search request, the DB column
 * and the API are unchanged. This is a presentation layer over the same live
 * sources, and the reason it exists is that the flat list had grown to 57
 * checkboxes and 57 chips: a wall that tells a reader nothing about what is
 * in the corpus and cannot be navigated.
 *
 * The grouping is finer than `SourceDef.group`, which is the ingestion-side
 * bucketing and puts all 44 administrative bodies under one heading. Here they
 * split three ways — appeal boards, ministries, valuation committees — because
 * that is the distinction a researcher is making when they narrow to one.
 *
 * Both invariants below are held down by source-tree.test.ts: a source added to
 * sources.ts and forgotten here would silently become unreachable from the
 * panel, which is exactly the kind of failure nobody notices.
 */

import { SOURCES } from "./sources";

export interface SourceSubGroup {
  id: string;
  name: string;
  keys: string[];
}

export interface SourceGroup {
  id: string;
  name: string;
  /** Direct members, shown above any subgroups. */
  keys: string[];
  /** Optional third level — only "Stjórnsýsla og eftirlit" needs it. */
  subGroups?: SourceSubGroup[];
}

export const SOURCE_TREE: SourceGroup[] = [
  {
    id: "domstolar",
    name: "Íslenskir dómstólar",
    keys: [
      "haestirettur",
      "landsrettur",
      "heradsdomar",
      "endurupptokudomur",
      "felagsdomur",
    ],
  },
  {
    id: "ees-efta",
    name: "EES / EFTA",
    keys: ["eftacourt", "eea-joint-committee", "eftasurv"],
  },
  {
    id: "esb",
    name: "Evrópusambandið",
    keys: ["cjeu", "eu-general-court"],
  },
  {
    id: "stjornsysla",
    name: "Stjórnsýsla og eftirlit",
    keys: ["umbodsmadur"],
    subGroups: [
      {
        id: "kaerunefndir",
        name: "Kæru- og úrskurðarnefndir",
        keys: [
          "kaerunefnd-utlendingamala",
          "unv-almannatryggingar",
          "kaerunefnd-husamala",
          "unv-atvinnuleysistryggingar",
          "kaerunefnd-utbodsmala",
          "urskurdarnefnd-upplysingamala",
          "unv-felagsthjonusta",
          "unv-faedingarorlof",
          "unv-greidsluadlogun",
          "kaerunefnd-jafnrettismala",
          "unv-barnavernd",
          "endurupptokunefnd",
          "hollustuhaettanefnd",
          "leidrettingarnefnd",
          "urskurdarnefnd-raforkumala",
          "urskurdarnefnd-kosningamala",
          "afryjunarnefnd-haskolanema",
          "uua",
          "yfirskattanefnd",
          "afryjunarnefnd-neytendamala",
        ],
      },
      {
        id: "raduneyti",
        name: "Ráðuneyti og stjórnsýsla",
        keys: [
          "innvidaraduneyti",
          "velferdarraduneyti-2011-2018",
          "sjavarutvegur-fiskeldi",
          "heilbrigdisraduneyti",
          "stjornsyslukaerur",
          "umhverfisraduneyti",
          "matvaeli-landbunadur",
          "menntamalaraduneyti",
          "felagsmalaraduneyti",
          "landskjorstjorn",
          "sveitarstjornarmal",
          "ferdathjonusta",
          "vidskiptamal",
          "innanrikisraduneyti-utlendingamal",
          "menningarraduneyti",
          "forsaetisraduneyti",
          "kosningaurskurdir",
          "utanrikisraduneyti",
        ],
      },
      {
        id: "matsnefndir",
        name: "Mats- og sérnefndir",
        keys: [
          "yfirfasteignamatsnefnd",
          "matsnefnd-eignarnamsbota",
          "matsnefnd-lax-og-silungsveidi",
          "mannanafnanefnd",
          "lausn-um-stundarsakir",
          "obyggdanefnd",
        ],
      },
    ],
  },
  {
    id: "fraedirit",
    name: "Fræðirit",
    keys: ["logretta", "ulfljotur"],
  },
];

/** Every key a group represents, its subgroups included. */
export function groupKeys(group: SourceGroup): string[] {
  return [...group.keys, ...(group.subGroups ?? []).flatMap((s) => s.keys)];
}

/** Every key in the tree, in the order the panel renders them. */
export function allTreeKeys(): string[] {
  return SOURCE_TREE.flatMap(groupKeys);
}

export interface FilterChip {
  /** What the chip says — a group name, or a source's own name. */
  label: string;
  /** The keys removing the chip deselects. */
  keys: string[];
  /** A whole category folded into one pill, rather than a single source. */
  isGroup: boolean;
}

/**
 * What the chip row should render for a selection.
 *
 * The point of the redesign: 57 chips said nothing that "everything" would not
 * have said in one word, so the default — all sources, or none ticked, which
 * the search treats as all — renders no chips at all. A category that is
 * entirely chosen collapses to one pill; a category chosen in part names the
 * sources, because that is the state where which ones matters.
 *
 * `nameOf` resolves a key to the source's own name. It is passed in rather
 * than read from SOURCES here so the panel can label a chip with whatever the
 * API returned, which is the list the user actually ticked.
 */
export function activeFilterChips(
  selected: Set<string>,
  allKeys: string[],
  nameOf: (key: string) => string
): FilterChip[] {
  if (selected.size === 0 || selected.size === allKeys.length) return [];

  const chips: FilterChip[] = [];
  for (const group of SOURCE_TREE) {
    const keys = groupKeys(group);
    const chosen = keys.filter((k) => selected.has(k));
    if (chosen.length === 0) continue;
    if (chosen.length === keys.length) {
      chips.push({ label: group.name, keys, isGroup: true });
    } else {
      for (const k of chosen) chips.push({ label: nameOf(k), keys: [k], isGroup: false });
    }
  }
  // A key that is ticked but absent from the tree would otherwise be a filter
  // with no chip — invisible, and unremovable without clearing everything.
  const inTree = new Set(allTreeKeys());
  for (const k of selected) {
    if (!inTree.has(k)) chips.push({ label: nameOf(k), keys: [k], isGroup: false });
  }
  return chips;
}

/** The tree's keys that the given source list actually offers. */
export function liveKeysOf(group: SourceGroup, available: Set<string>): string[] {
  return groupKeys(group).filter((k) => available.has(k));
}

/** Source names by key, for the chip row and the panel's own labels. */
export function sourceNames(): Map<string, string> {
  return new Map(SOURCES.map((s) => [s.key, s.name]));
}
