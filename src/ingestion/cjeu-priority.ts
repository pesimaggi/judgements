/**
 * The judgments of the Court of Justice this library cannot do without, fetched
 * before the year sweep reaches them.
 *
 * WHY THIS LIST EXISTS. The CJEU adapter sweeps one calendar year at a time,
 * newest first, through about 33,000 judgments — the right default, because the
 * case law anyone is looking for is mostly recent and the 1950s can wait. But
 * landmark case law is not distributed evenly by date, and the sweep reaching
 * 2011 is months of polite fetching away from a corpus that starts at 2026.
 *
 * The cost of that showed up in a scored answer. Asked whether a parent moving
 * abroad with a disabled child can fall between two social security systems —
 * a question about Regulation 883/2004 and Article 21 TFEU — the well returned
 * nine judgments, none of them about disability, care benefits or children, and
 * said so itself. A comparator answered the same question with Stewart,
 * Hendrix, von Chamier-Glisczinski, A (Assistance for a disabled person) and
 * Dano. Every one of those is from 2007–2018: precisely the years the sweep had
 * not reached. See Q3 in docs/ai-answer-evaluation.md.
 *
 * So this is a queue-jumping list, not a second corpus. Every judgment here
 * would arrive eventually; the list only says which ones are worth a request
 * now. A few dozen fetches buys most of the canon an EEA lawyer reasons from.
 *
 * WHAT BELONGS HERE. A judgment earns a place by being one an Icelandic or
 * Norwegian lawyer would cite in an EEA argument and would expect any legal
 * research tool to know: the free movement fundamentals the EFTA Court follows
 * under the homogeneity principle, and the social security coordination line
 * that Regulation 883/2004 questions turn on. Not "important judgments" in
 * general — the General Court's trade mark appeals are important to somebody,
 * and the year sweep will bring them.
 *
 * WHAT DOES NOT BELONG HERE. Anything the sweep has already passed, which is
 * checked rather than guessed: a judgment already stored costs one indexed
 * lookup and no request. And anything whose case number is a guess — see the
 * name check in the adapter, which exists because a mistyped number is a real
 * judgment fetched under a false name.
 *
 * HOW TO ADD ONE. Write the case number as the Court cites it and say in the
 * note what it is authority for, in the terms someone would search for. The
 * note is not decoration: `name` is checked against the title EUR-Lex returns,
 * so a wrong number is caught in the run log instead of silently storing the
 * wrong judgment.
 */

/** One judgment on the priority list. */
export interface PriorityCase {
  /** As the Court cites it: "C-503/09". */
  caseNumber: string;
  /**
   * A distinctive fragment of the party name, matched case-insensitively
   * against the title EUR-Lex returns. It is the guard on a mistyped case
   * number, so it has to be a string that appears in the title and would not
   * appear in a different judgment's — a surname or an institution, not
   * "Commission".
   */
  name: string;
  /** What it is authority for. */
  note: string;
}

/**
 * Social security coordination: Regulation 883/2004 and its predecessor 1408/71.
 *
 * The branch this list was written for, and the one where the gap was measured.
 * The classification questions — is a care allowance a sickness benefit in cash
 * or a special non-contributory benefit, and what follows either way — are the
 * whole game in a coordination dispute, and they were decided between 1998 and
 * 2012.
 */
const SOCIAL_SECURITY: PriorityCase[] = [
  {
    caseNumber: "C-160/96",
    name: "Molenaar",
    note: "German care insurance allowance is a sickness benefit in cash, so it is exportable — the first case in the care-benefit classification line.",
  },
  {
    caseNumber: "C-215/99",
    name: "Jauch",
    note: "Austrian Pflegegeld is a sickness benefit in cash and not a special non-contributory benefit, whatever the Annex says — listing a benefit does not make it one.",
  },
  {
    caseNumber: "C-286/03",
    name: "Hosse",
    note: "A care allowance claimed by the family member of a migrant worker; the classification in Jauch applied to a derived claim.",
  },
  {
    caseNumber: "C-287/05",
    name: "Hendrix",
    note: "A benefit may be lawfully non-exportable under the coordination Regulation and its refusal still be tested for proportionality under free movement of workers.",
  },
  {
    caseNumber: "C-208/07",
    name: "Chamier-Glisczinski",
    note: "Coordination is not harmonisation: moving between two care systems need not be financially neutral. The principal counter-authority to any 'I lost out by moving' argument.",
  },
  {
    caseNumber: "C-503/09",
    name: "Stewart",
    note: "Incapacity benefit for a disabled young person who moved abroad with her parents; a past-presence condition is disproportionate where it excludes other ways of showing a genuine link, and the parents' links count towards the child's.",
  },
  {
    caseNumber: "C-522/10",
    name: "Reichel-Albert",
    note: "Article 21 TFEU obliges the State of origin to take account of child-raising periods completed in another Member State. The line C-576/20 extends.",
  },
  {
    caseNumber: "C-333/13",
    name: "Dano",
    note: "Equal treatment under Article 4 does not override a lawful-residence condition for special non-contributory benefits claimed by an economically inactive citizen.",
  },
  {
    caseNumber: "C-679/16",
    name: "Korkein hallinto-oikeus",
    note: "Personal assistance for a severely disabled student falls outside Regulation 883/2004, and Articles 20 and 21 TFEU still bar refusing it because he studies in another Member State.",
  },
  {
    caseNumber: "C-283/21",
    name: "Deutsche Rentenversicherung",
    note: "Child-raising periods again, on Article 44(2) of Regulation 987/2009 — the provision C-576/20 turns on.",
  },
  {
    caseNumber: "C-257/24",
    name: "Aachen",
    note: "School assistance for a disabled child refused for residence abroad while the mother worked in the State refusing it: a restriction under Article 7(2) of Regulation 492/2011. The nearest thing to a decided case on a parent moving with a disabled child.",
  },
];

/**
 * Free movement of persons and Union citizenship.
 *
 * The EFTA Court follows this court on the corresponding EEA provisions, so
 * these are cited in Icelandic argument as a matter of course. They are also
 * what a coordination case falls back on when the Regulation runs out, which is
 * exactly the move the Q3 question was asking about.
 */
const FREE_MOVEMENT: PriorityCase[] = [
  {
    caseNumber: "C-415/93",
    name: "Bosman",
    note: "A rule is a restriction on free movement of workers even without discrimination, if it impedes or deters leaving the State of origin.",
  },
  {
    caseNumber: "C-224/98",
    name: "Hoop",
    note: "A citizen must not be disadvantaged in his or her own State for having exercised free movement — the proposition the EFTA Court states in its own terms.",
  },
  {
    caseNumber: "C-184/99",
    name: "Grzelczyk",
    note: "Union citizenship is destined to be the fundamental status of nationals of the Member States; equal treatment in social assistance for a student.",
  },
  {
    caseNumber: "C-413/99",
    name: "Baumbast",
    note: "Article 21 TFEU is directly effective, and conditions on residence are subject to proportionality.",
  },
  {
    caseNumber: "C-138/02",
    name: "Collins",
    note: "A genuine link with the employment market may be required for a jobseeker's allowance, but the requirement must be proportionate.",
  },
  {
    caseNumber: "C-456/02",
    name: "Trojani",
    note: "Where a citizen lawfully resides, equal treatment in social assistance follows, whatever the residence is founded on.",
  },
  {
    caseNumber: "C-209/03",
    name: "Bidar",
    note: "The genuine-link test applied to student maintenance; a degree of financial solidarity between nationals of different Member States.",
  },
  {
    caseNumber: "C-34/09",
    name: "Ruiz Zambrano",
    note: "A measure depriving a Union citizen child of the genuine enjoyment of the substance of citizenship rights is precluded, even without any cross-border movement.",
  },
  {
    caseNumber: "C-133/15",
    name: "Chavez-Vilchez",
    note: "The Ruiz Zambrano line where a third-country parent is the child's primary carer; dependency assessed on the child's best interests.",
  },
];

/**
 * The internal market fundamentals.
 *
 * Every one of these is followed in EEA law and cited in Icelandic argument
 * about the four freedoms. They are old, which under a newest-first sweep is
 * exactly the problem: the corpus will reach 1979 last.
 */
const INTERNAL_MARKET: PriorityCase[] = [
  {
    caseNumber: "C-120/78",
    name: "Rewe-Zentral",
    note: "Cassis de Dijon: mutual recognition, and mandatory requirements as a ground for measures having equivalent effect. Cited as Case 120/78 — the C- prefix postdates it, and the CELEX is the same either way.",
  },
  {
    caseNumber: "C-267/91",
    name: "Keck",
    note: "Selling arrangements are outside Article 34 TFEU where they apply equally in law and in fact. The qualification on Dassonville every goods argument passes through.",
  },
  {
    caseNumber: "C-76/90",
    name: "Säger",
    note: "Freedom to provide services is restricted by any measure liable to prohibit, impede or render less attractive its exercise.",
  },
  {
    caseNumber: "C-55/94",
    name: "Gebhard",
    note: "The four-condition justification test — non-discriminatory, imperative requirement in the general interest, suitable, not going beyond what is necessary.",
  },
  {
    caseNumber: "C-212/97",
    name: "Centros",
    note: "Establishment in the Member State with the least demanding company law is the exercise of a Treaty freedom, not an abuse of it.",
  },
  {
    caseNumber: "C-438/05",
    name: "Viking",
    note: "Collective action as a restriction on establishment, and how a social objective is weighed against an economic freedom.",
  },
  {
    caseNumber: "C-341/05",
    name: "Laval",
    note: "Posted workers and the limits on what a host State may demand through collective action.",
  },
];

/**
 * The whole list, in the order it is fetched.
 *
 * Social security first because that is the branch where the gap was measured,
 * then the citizenship cases a coordination argument falls back on, then the
 * internal market fundamentals. A run that spends its budget part way through
 * resumes here next time, so the order is the priority.
 */
export const PRIORITY_CASES: PriorityCase[] = [
  ...SOCIAL_SECURITY,
  ...FREE_MOVEMENT,
  ...INTERNAL_MARKET,
];
