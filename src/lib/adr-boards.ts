/**
 * The úrskurðarnefndir, kærunefndir and ministry appeal bodies published at
 * stjornarradid.is/gogn/urskurdir-og-alit-/ — Iceland's administrative
 * dispute-resolution bodies, the layer of decisions that sits between an
 * agency and the courts.
 *
 * They arrive through one search endpoint, but they are not one body: a
 * ruling of Kærunefnd útboðsmála and one of Mannanafnanefnd have nothing to
 * do with each other, and a researcher wants to tick the one they mean. So
 * every board here becomes its own source in src/lib/sources.ts — its own
 * key, its own checkbox, its own row on the progress page — and this file is
 * what makes the two agree.
 *
 * IDENTIFYING A BOARD. Three identifiers are in play and they are not
 * interchangeable:
 *
 *  - `key` is ours. It is what goes in the database's `source` column and in
 *    the `?sources=` query, so it must never change once documents carry it.
 *    It is deliberately hand-written rather than slugified from the name,
 *    because the site does rename boards (ministries merge and split) and a
 *    derived key would silently split a board's archive in two.
 *  - `committee` is the site's. It is the exact `Committee=` value its search
 *    accepts, and the site's own primary key for a board — so it is copied
 *    verbatim, exotic characters included. Two of them are not what they
 *    look like: several names carry U+066B ARABIC DECIMAL SEPARATOR where a
 *    comma belongs, and "Álit á sviði sveitarstjórnarmála" has a non-breaking
 *    space after "Álit". Both are written as escapes below so they survive an
 *    editor, a linter, and anyone who "fixes the typo". Change either and the
 *    board returns nothing.
 *  - `boardId` is the site's GUID for boards that have their own page
 *    (/stok-urskurdarnefnd/?itemid=…). Only about a quarter of them do, which
 *    is why it cannot be the identifier, but where it exists it is stable
 *    across renames and worth keeping.
 *
 * `name` is the site's name with those two characters normalized for display.
 * `ministry` is the ministry the board's cases are filed under — the site's
 * own Ministries facet, taken as the one that covers most of the board's
 * cases, since a few boards straddle two after a reorganisation.
 *
 * `approxCases` is the count the site's own dropdown reported when this list
 * was compiled (August 2026, ~23,700 cases in total). It is a rough target
 * for the progress page, not a contract — the adapter overwrites
 * Source.totalAvailable with the live count on every run.
 */
export interface AdrBoard {
  /** Our stable source key. Never change it once documents exist. */
  key: string;
  /** Display name, with the site's odd characters normalized. */
  name: string;
  /** The site's exact `Committee=` filter value. Copied verbatim. */
  committee: string;
  /** Ministry the board's cases are filed under, for grouping. */
  ministry: string;
  /** The site's GUID for the board's own page, where it has one. */
  boardId?: string;
  /** Cases the site reported for this board when the list was compiled. */
  approxCases: number;
}

/** Every board in the úrskurðir og álit collection, largest archive first. */
export const ADR_BOARDS: AdrBoard[] = [
  {
    key: "kaerunefnd-utlendingamala",
    name: "Kærunefnd útlendingamála",
    committee: "Kærunefnd útlendingamála",
    ministry: "Dómsmálaráðuneytið",
    boardId: "e219adbc-4214-11e7-941a-005056bc530c",
    approxCases: 4846,
  },
  {
    key: "unv-almannatryggingar",
    name: "Úrskurðarnefnd velferðarmála - Almannatryggingar",
    committee: "Úrskurðarnefnd velferðarmála - Almannatryggingar",
    ministry: "Félags- og húsnæðismálaráðuneytið",
    approxCases: 3453,
  },
  {
    key: "kaerunefnd-husamala",
    name: "Kærunefnd húsamála",
    committee: "Kærunefnd húsamála",
    ministry: "Félags- og húsnæðismálaráðuneytið",
    boardId: "e219adb0-4214-11e7-941a-005056bc530c",
    approxCases: 2013,
  },
  {
    key: "unv-atvinnuleysistryggingar",
    name: "Úrskurðarnefnd velferðarmála - Atvinnuleysistryggingar og vinnumarkaðsaðgerðir",
    committee: "Úrskurðarnefnd velferðarmála - Atvinnuleysistryggingar og vinnumarkaðsaðgerðir",
    ministry: "Félags- og húsnæðismálaráðuneytið",
    approxCases: 1930,
  },
  {
    key: "mannanafnanefnd",
    name: "Mannanafnanefnd",
    committee: "Mannanafnanefnd",
    ministry: "Dómsmálaráðuneytið",
    boardId: "e219adf8-4214-11e7-941a-005056bc530c",
    approxCases: 1817,
  },
  {
    key: "kaerunefnd-utbodsmala",
    name: "Kærunefnd útboðsmála",
    committee: "Kærunefnd útboðsmála",
    ministry: "Fjármála- og efnahagsráðuneytið",
    boardId: "e219adb9-4214-11e7-941a-005056bc530c",
    approxCases: 1417,
  },
  {
    key: "urskurdarnefnd-upplysingamala",
    name: "Úrskurðarnefnd um upplýsingamál",
    committee: "Úrskurðarnefnd um upplýsingamál",
    ministry: "Forsætisráðuneytið",
    boardId: "12383b53-4215-11e7-941a-005056bc530c",
    approxCases: 1383,
  },
  {
    key: "unv-felagsthjonusta",
    name: "Úrskurðarnefnd velferðarmála - Félagsþjónusta og húsnæðismál",
    committee: "Úrskurðarnefnd velferðarmála - Félagsþjónusta og húsnæðismál",
    ministry: "Félags- og húsnæðismálaráðuneytið",
    approxCases: 1006,
  },
  {
    key: "innvidaraduneyti",
    name: "Úrskurðir á málefnasviði innviðaráðuneytisins",
    committee: "Úrskurðir á málefnasviði innviðaráðuneytisins",
    ministry: "Innviðaráðuneytið",
    approxCases: 841,
  },
  {
    key: "unv-faedingarorlof",
    name: "Úrskurðarnefnd velferðarmála - Fæðingar- og foreldraorlof",
    committee: "Úrskurðarnefnd velferðarmála - Fæðingar- og foreldraorlof",
    ministry: "Félags- og húsnæðismálaráðuneytið",
    approxCases: 749,
  },
  {
    key: "yfirfasteignamatsnefnd",
    name: "Yfirfasteignamatsnefnd",
    committee: "Yfirfasteignamatsnefnd",
    ministry: "Félags- og húsnæðismálaráðuneytið",
    boardId: "1839f74a-4215-11e7-941a-005056bc530c",
    approxCases: 668,
  },
  {
    key: "unv-greidsluadlogun",
    name: "Úrskurðarnefnd velferðarmála - Greiðsluaðlögunarmál",
    committee: "Úrskurðarnefnd velferðarmála - Greiðsluaðlögunarmál",
    ministry: "Félags- og húsnæðismálaráðuneytið",
    approxCases: 606,
  },
  {
    key: "kaerunefnd-jafnrettismala",
    name: "Kærunefnd jafnréttismála",
    committee: "Kærunefnd jafnréttismála",
    ministry: "Dómsmálaráðuneytið",
    boardId: "e219adb3-4214-11e7-941a-005056bc530c",
    approxCases: 358,
  },
  {
    key: "unv-barnavernd",
    name: "Úrskurðarnefnd velferðarmála - Barnaverndarmál",
    committee: "Úrskurðarnefnd velferðarmála - Barnaverndarmál",
    ministry: "Mennta- og barnamálaráðuneytið",
    approxCases: 342,
  },
  {
    key: "matsnefnd-eignarnamsbota",
    name: "Matsnefnd eignarnámsbóta",
    committee: "Matsnefnd eignarnámsbóta",
    ministry: "Dómsmálaráðuneytið",
    boardId: "e82c1349-4214-11e7-941a-005056bc530c",
    approxCases: 301,
  },
  {
    key: "velferdarraduneyti-2011-2018",
    name: "Úrskurðir velferðarráðuneytisins 2011-2018",
    committee: "Úrskurðir velferðarráðuneytisins 2011-2018",
    ministry: "Félags- og húsnæðismálaráðuneytið",
    approxCases: 236,
  },
  {
    key: "sjavarutvegur-fiskeldi",
    name: "Úrskurðir um sjávarútveg og fiskeldi",
    committee: "Úrskurðir um sjávarútveg og fiskeldi",
    ministry: "Atvinnuvegaráðuneytið",
    approxCases: 215,
  },
  {
    key: "heilbrigdisraduneyti",
    name: "Úrskurðir heilbrigðisráðuneytis",
    committee: "Úrskurðir heilbrigðisráðuneytis",
    ministry: "Heilbrigðisráðuneytið",
    approxCases: 174,
  },
  {
    key: "stjornsyslukaerur",
    name: "Stjórnsýslukærur - úrskurðir",
    committee: "Stjórnsýslukærur - úrskurðir",
    ministry: "Fjármála- og efnahagsráðuneytið",
    approxCases: 161,
  },
  {
    key: "umhverfisraduneyti",
    name: "Úrskurðir umhverfis-, orku- og loftslagsráðuneytisins",
    committee: "Úrskurðir umhverfis-\u066B orku- og loftslagsráðuneytisins",
    ministry: "Umhverfis-, orku- og loftslagsráðuneytið",
    approxCases: 141,
  },
  {
    key: "matvaeli-landbunadur",
    name: "Úrskurðir um matvæli og landbúnað",
    committee: "Úrskurðir um matvæli og landbúnað",
    ministry: "Atvinnuvegaráðuneytið",
    approxCases: 131,
  },
  {
    key: "endurupptokunefnd",
    name: "Endurupptökunefnd",
    committee: "Endurupptökunefnd",
    ministry: "Dómsmálaráðuneytið",
    approxCases: 113,
  },
  {
    key: "menntamalaraduneyti",
    name: "Úrskurðir mennta- og barnamálaráðuneytisins",
    committee: "Úrskurðir mennta- og barnamálaráðuneytisins",
    ministry: "Mennta- og barnamálaráðuneytið",
    approxCases: 108,
  },
  {
    key: "felagsdomur",
    name: "Félagsdómur",
    committee: "Félagsdómur",
    ministry: "Félags- og húsnæðismálaráðuneytið",
    boardId: "dc04e614-4214-11e7-941a-005056bc530c",
    approxCases: 107,
  },
  {
    key: "hollustuhaettanefnd",
    name: "Úrskurðarnefnd samkvæmt lögum um hollustuhætti og mengunarvarnir",
    committee: "Úrskurðarnefnd samkvæmt lögum um hollustuhætti og mengunarvarnir",
    ministry: "Umhverfis-, orku- og loftslagsráðuneytið",
    approxCases: 92,
  },
  {
    key: "felagsmalaraduneyti",
    name: "Úrskurðir félags- og húsnæðismálaráðuneytisins",
    committee: "Úrskurðir félags- og húsnæðismálaráðuneytisins",
    ministry: "Félags- og húsnæðismálaráðuneytið",
    approxCases: 85,
  },
  {
    key: "leidrettingarnefnd",
    name: "Úrskurðarnefnd um leiðréttingu verðtryggðra fasteignaveðlána",
    committee: "Úrskurðarnefnd um leiðréttingu verðtryggðra fasteignaveðlána",
    ministry: "Fjármála- og efnahagsráðuneytið",
    approxCases: 78,
  },
  {
    key: "landskjorstjorn",
    name: "Úrskurðir landskjörstjórnar",
    committee: "Úrskurðir landskjörstjórnar",
    ministry: "Dómsmálaráðuneytið",
    approxCases: 78,
  },
  {
    key: "sveitarstjornarmal",
    name: "Álit á sviði sveitarstjórnarmála",
    committee: "Álit\u00A0á sviði sveitarstjórnarmála",
    ministry: "Innviðaráðuneytið",
    approxCases: 50,
  },
  {
    key: "ferdathjonusta",
    name: "Úrskurðir ferðaþjónusta",
    committee: "Úrskurðir ferðaþjónusta",
    ministry: "Atvinnuvegaráðuneytið",
    approxCases: 48,
  },
  {
    key: "afryjunarnefnd-haskolanema",
    name: "Áfrýjunarnefnd í kærumálum háskólanema",
    committee: "Áfrýjunarnefnd í kærumálum háskólanema",
    ministry: "Menningar-, nýsköpunar- og háskólaráðuneytið",
    boardId: "dc04e587-4214-11e7-941a-005056bc530c",
    approxCases: 29,
  },
  {
    key: "lausn-um-stundarsakir",
    name: "Nefnd vegna lausnar um stundarsakir",
    committee: "Nefnd vegna lausnar um stundarsakir",
    ministry: "Fjármála- og efnahagsráðuneytið",
    approxCases: 27,
  },
  {
    key: "urskurdarnefnd-raforkumala",
    name: "Úrskurðarnefnd raforkumála",
    committee: "Úrskurðarnefnd raforkumála",
    ministry: "Umhverfis-, orku- og loftslagsráðuneytið",
    boardId: "12383b41-4215-11e7-941a-005056bc530c",
    approxCases: 24,
  },
  {
    key: "matsnefnd-lax-og-silungsveidi",
    name: "Matsnefnd samkvæmt lögum um lax- og silungsveiði",
    committee: "Matsnefnd samkvæmt lögum um lax- og silungsveiði",
    ministry: "Atvinnuvegaráðuneytið",
    approxCases: 15,
  },
  {
    key: "vidskiptamal",
    name: "Úrskurðir viðskiptamál",
    committee: "Úrskurðir viðskiptamál",
    ministry: "Atvinnuvegaráðuneytið",
    approxCases: 15,
  },
  {
    key: "urskurdarnefnd-kosningamala",
    name: "Úrskurðarnefnd kosningamála",
    committee: "Úrskurðarnefnd kosningamála",
    ministry: "Dómsmálaráðuneytið",
    boardId: "14e8aa56-c09f-11ec-8148-005056bcf582",
    approxCases: 12,
  },
  {
    key: "innanrikisraduneyti-utlendingamal",
    name: "Úrskurðir innanríkisráðuneytisins á sviði útlendingamála fram til 1. janúar 2015",
    committee: "Úrskurðir innanríkisráðuneytisins á sviði útlendingamála fram til 1. janúar 2015",
    ministry: "Dómsmálaráðuneytið",
    approxCases: 12,
  },
  {
    key: "menningarraduneyti",
    name: "Úrskurðir á málefnasviðum menningar-, nýsköpunar- og háskólaráðuneytisins",
    committee: "Úrskurðir á málefnasviðum menningar-\u066B nýsköpunar- og háskólaráðuneytisins",
    ministry: "Menningar-, nýsköpunar- og háskólaráðuneytið",
    approxCases: 12,
  },
  {
    key: "forsaetisraduneyti",
    name: "Úrskurðir forsætisráðuneytisins",
    committee: "Úrskurðir forsætisráðuneytisins",
    ministry: "Forsætisráðuneytið",
    approxCases: 5,
  },
  {
    key: "kosningaurskurdir",
    name: "Úrskurðir vegna kosninga",
    committee: "Úrskurðir vegna kosninga",
    ministry: "Dómsmálaráðuneytið",
    approxCases: 4,
  },
  {
    key: "utanrikisraduneyti",
    name: "Úrskurðir utanríkisráðuneytisins",
    committee: "Úrskurðir utanríkisráðuneytisins",
    ministry: "Utanríkisráðuneytið",
    approxCases: 1,
  },
];

export const ADR_BOARD_KEYS = new Set(ADR_BOARDS.map((b) => b.key));

export function adrBoardByKey(key: string): AdrBoard | undefined {
  return ADR_BOARDS.find((b) => b.key === key);
}

/** The site the boards publish on. */
export const STJORNARRADID_BASE = "https://www.stjornarradid.is";

/** The collection all of them live in. */
export const URSKURDIR_PATH = "/gogn/urskurdir-og-alit-";

/**
 * A board's listing on stjornarradid.is: the site's own search, filtered to
 * that board and sorted newest first.
 *
 * This doubles as the board's officialBaseUrl, because most boards have no
 * page of their own — the filtered search *is* where the site puts a board's
 * decisions. Pass `page` (0-based, 200 results a page) to walk it.
 *
 * `Committee` is passed through URLSearchParams rather than hand-escaped, so
 * the U+066B and non-breaking space in some board names survive the trip.
 */
export function boardListUrl(
  board: AdrBoard,
  opts: { page?: number; base?: string } = {}
): string {
  const params = new URLSearchParams({
    SearchQuery: "",
    Committee: board.committee,
    ContentTypes: "",
    Themes: "",
    Ministries: "",
    Year: "",
    PageIndex: String(opts.page ?? 0),
    SortByDate: "True",
  });
  const base = (opts.base ?? STJORNARRADID_BASE).replace(/\/$/, "");
  return `${base}${URSKURDIR_PATH}/$LisasticSearch/Search/?${params}`;
}

/**
 * A single decision's page. `newsid` alone is enough — the `cname` and `cid`
 * the site's own links carry are decoration, and leaving them off keeps the
 * stored officialUrl stable if a board is ever renamed.
 */
export function decisionUrl(newsId: string, base = STJORNARRADID_BASE): string {
  return `${base.replace(/\/$/, "")}${URSKURDIR_PATH}/stakur-urskurdur/?newsid=${newsId}`;
}
