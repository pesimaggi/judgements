# Manual AI answer evaluation

This is a human-reviewed log of AI answers, separate from the automated [search evaluation](search-evaluation.md). It does not run tests automatically.

## How to keep testing

- Q identifies a fixed test question. A1, A2, etc. identify successive supplied outputs for that question.
- Add each new output as a new row with its full text; keep previous outputs for comparison.
- Comments are the reviewer's own words. Preserve answers and comments without silently correcting them.
- Rate each output from 0–10 only when there is enough information to assess it. A blank rating means **not yet rated**, not zero; exclude blanks from any averages.
- For future runs, record the actual run date, model/configuration and application commit when known. Do not infer them from the date the notes were added.
- Reference answers and supporting source URLs can be added once verified. The outputs below are test evidence, not verified legal conclusions.

## Q1 — E-5/21 and the Icelandic proceedings

út á hvað gekk EFTA dómstólsmálið E-5/21. Hver var niðurstaðan og er búið að dæma í málinu hjá Hæstarétti Íslands?

### Evaluation table

Full outputs and reviewer comments are reproduced directly in the table, without summaries or collapsed sections.

| Question | Run | Full AI output | Comment | Rating (0–10) |
| --- | --- | --- | --- | --- |
| Q1 | A1 | E-5/21 laut að máli Önnu Bryndísar Einarsdóttur gegn íslenska ríkinu og snerist um félagslegt öryggi, stöðu farandverkafólks, jafnræði og útreikning fæðingarstyrks samkvæmt 6. og 21. gr. reglugerðar (EB) nr. 883/2004.1 Málið barst EFTA-dómstólnum sem beiðni Héraðsdóms Reykjavíkur um ráðgefandi álit.1 Gögnin sem hér liggja fyrir sýna hins vegar ekki efnislega niðurstöðu EFTA-dómstólsins í málinu; þau sýna aðeins málsheiti, álitaefnið og að beiðnin hafi komið frá Héraðsdómi Reykjavíkur.1 Þau sýna heldur ekki að Hæstiréttur Íslands hafi kveðið upp dóm í tengdu máli, þannig að ekki verður staðfest af þessum heimildum hvort slíkur dómur hafi fallið.<br>Ákvæðin og álitaefnið<br><br>Í samantekt EFTA-dómstólsins eru tilgreind 6. og 21. gr. reglugerðar (EB) nr. 883/2004 sem lagagrundvöllur álitaefnisins.1<br>Ágreiningsefnið var lýst sem útreikningi fæðingarstyrks í samhengi við félagslegt öryggi, farandverkafólk og jafna meðferð.1<br>Beiðnin kom frá Héraðsdómi Reykjavíkur í innanlandsmáli Önnu Bryndísar Einarsdóttur gegn íslenska ríkinu.1<br>Sú heimild sem fjallar um íslenska dómstólakerfið segir aðeins að Hæstiréttur Íslands sé æðsti dómstóll ríkisins; hún tengir hann ekki við þetta mál.5<br>Hvað heimildirnar sýna um framhaldið<br>Heimild1 er skráning og samantekt á E-5/21, en í henni kemur ekki fram niðurstaða, rökstuðningur eða úrskurðarorð EFTA-dómstólsins.1 Þar kemur heldur ekki fram neinn dómur Hæstaréttar Íslands í tengdu málinu.1 Til að svara seinni hlutanum og greina niðurstöðu málsins þyrfti því að leita sérstaklega að efnislegu áliti EFTA-dómstólsins í E-5/21 og síðar dómi í íslenska aðalmálinu, einkum eftir málsheiti aðilanna eða tilvísun Héraðsdóms Reykjavíkur. | Not good | |
| Q1 | A2 | Heimildirnar sem fylgja svara ekki því út á hvað mál E-5/21 hjá EFTA-dómstólnum gekk eða hver niðurstaða þess varð. Þær gefa heldur ekki upplýsingar um hvort Hæstiréttur Íslands hafi dæmt í tengdu máli, þannig að það verður ekki staðfest út frá þessum heimildum.<br><br>Ákvæðin sem heimildirnar ná til<br>5 fjallar um málsmeðferð og gjafsókn þegar íslenskur dómstóll ákveður að leita álits EFTA-dómstólsins. Ákvæðið segir hins vegar ekkert um mál E-5/21, efni þess eða niðurstöðu.<br>1 kveður á um að Hæstiréttur Íslands sé æðsti dómstóll ríkisins, en segir ekkert um tiltekið mál eða hvort slíkt mál hafi verið dæmt.<br>2 fjallar um lögsögu EFTA-dómstólsins til að endurskoða ákvarðanir Eftirlitsstofnunar EFTA um sektir eða févíti. Úr heimildinni verður ekki ráðið að það tengist máli E-5/21.<br>Dómsúrlausnir<br>Engin ákvörðun EFTA-dómstólsins eða dómur Hæstaréttar Íslands fylgir með leitarniðurstöðunum. Því er ekki hægt að lýsa efni eða niðurstöðu E-5/21 né svara því hvort tengdu máli hjá Hæstarétti hafi verið lokið. Leita þyrfti sérstaklega að „E-5/21 EFTA Court“ og að íslenskri birtingu eða málsnúmeri þess máls sem EFTA-dómstóllinn leitaði álits um, meðal annars í dómasafni Hæstaréttar. | getting worse | |
| Q1 | A3 | E-5/21 laut að máli Önnu Bryndísar Einarsdóttur gegn íslenska ríkinu. Reykjavíkurborg? Nei, heimildin segir að beiðnin hafi komið frá Héraðsdómi Reykjavíkur og varðaði almannatryggingar, réttarstöðu farandlaunþega, jafnræði og útreikning fæðingarorlofsbóta samkvæmt 6. og 21. gr. reglugerðar (EB) nr. 883/2004.8 Niðurstaða EFTA-dómstólsins kemur hins vegar ekki fram í þeim texta sem leitin skilaði: dómsorðið er stytt eftir setningunni um að dómstóllinn veiti ráðgefandi álit.8 Heimildirnar sýna heldur ekki hvort Hæstiréttur Íslands hafi síðan dæmt í aðalmálinu.<br><br>Ákvæðið sem tengist málinu<br>4. gr. laga nr. 21/1994 fjallar um gjafsókn og endurgreiðslu kostnaðar þegar íslenskur dómstóll hefur ákveðið að leita álits EFTA-dómstólsins. Hún segir meðal annars að gjafsókn geti tekið til kostnaðar vegna reksturs málsins fyrir EFTA-dómstólnum, en að þóknun umboðsmanns fyrir málflutning þar verði ákveðin í dómi í aðalmálinu.5<br>Þetta ákvæði segir ekki hver efnisleg niðurstaða E-5/21 var, heldur lýsir kostnaðar- og gjafsóknarreglum vegna öflunar ráðgefandi álits.5<br>Hæstiréttur Íslands er æðsti dómstóll ríkisins, en heimildin um það svarar ekki því hvort hann hafi kveðið upp dóm í máli Önnu Bryndísar Einarsdóttur.1<br>Hvað heimildirnar sýna um niðurstöðuna<br>EFTA-dómstóllinn fjallaði um beiðni Héraðsdóms Reykjavíkur og gaf ráðgefandi álit 29. júlí 2022.8<br>Í niðurstöðuhluta heimildarinnar stendur aðeins að dómstóllinn svari spurningu Héraðsdóms með ráðgefandi áliti; sjálfar spurningarnar og efnislegt svar eru ekki birt í útdrættinum.8<br>Engin af þeim heimildum sem fylgja spurningunni er dómur Hæstaréttar í aðalmálinu eða skráning sem staðfestir að slíkur dómur hafi fallið. Því er ekki unnt að svara út frá þessum heimildum hvort búið sé að dæma þar. Leita þyrfti sérstaklega að máli Önnu Bryndísar Einarsdóttur gegn íslenska ríkinu hjá Hæstarétti, eftir að EFTA-málið E-5/21 var flutt. | slight improvement but still very close to A1 - we still seem to be bumping into this issue where it does not actually read the judgement but only some summary of it, and what honestly seems to be a summary that includes very limited information. There is also this strange question sort of imbedded in the response "Reykjavíkurborg? Nei, heimildin segir að beiðnin hafi komið frá Héraðsdómi Reykjavíkur og varðaði almannatryggingar, réttarstöðu farandlaunþega, jafnræði og útreikning fæðingarorlofsbóta samkvæmt 6. og 21. gr. reglugerðar (EB) nr. 883/2004." Like it thught that Reykjavík asked the question. Very strange. If we have lovated the actual judgement, why not look at it in detail? | |
| Q1 | A4 | Mál E-5/21 var beiðni Héraðsdóms Reykjavíkur um ráðgefandi álit í máli Önnu Bryndísar Einarsdóttur gegn íslenska ríkinu. Það laut að 6. og 21. gr. reglugerðar (EB) nr. 883/2004, félagslegu öryggi, farandverkafólki, jafnræði og útreikningi fæðingarbóta. [1]<br>Niðurstaða EFTA-dómstólsins verður hins vegar ekki lesin úr þeim gögnum sem hér liggja fyrir: dómsorðið segir aðeins að dómstóllinn gefi ráðgefandi álit og síðan er efnið fellt út. [1] Heimildirnar sýna heldur ekki að Hæstiréttur Íslands hafi dæmt í tengdu málinu, þannig að ekki er unnt að svara því játandi eða neitandi á grundvelli þeirra.<br>## Þær reglur sem heimildirnar sýna<br>- Heimildin tengir málið við 6. og 21. gr. reglugerðar (EB) nr. 883/2004 og lýsir álitaefninu sem útreikningi fæðingarbóta fyrir farandverkafólk með hliðsjón af jafnræði. [1]<br>- Málið hjá EFTA-dómstólnum var ráðgefandi álit að beiðni Héraðsdóms Reykjavíkur, ekki dómur sem heimildin sýnir að Hæstiréttur hafi kveðið upp. [1]<br>- Sú heimild sem fjallar um Hæstarétt segir aðeins að hann sé æðsti dómstóll ríkisins og hafi aðsetur í Reykjavík; hún tilgreinir ekkert tengt mál eða niðurstöðu þess. [5]<br>## Niðurstaða og tengt mál<br>Í heimildinni er ekki birt svar EFTA-dómstólsins við álitaefninu, heldur aðeins upphaf dómsorðsins. [1] Því er ekki hægt að fullyrða út frá þessum gögnum hvort dómstóllinn taldi íslensku reglurnar eða útreikning fæðingarbóta samrýmast reglugerðinni, né hver nákvæm áhrif álitsins voru á íslenska málið.<br>Til að svara seinni hlutanum þarf að leita að fullu dómsorði E-5/21 og að sérstöku máli hjá Hæstarétti undir nafni Önnu Bryndísar Einarsdóttur gegn íslenska ríkinu. | | |

### Evaluation context

| Field | Value |
| --- | --- |
| Rating status | A1–A4 await rating |
| Actual test dates | A1–A3 not supplied. A4: 14 September 2026 |
| Model / configuration / application commit | A1–A3 not supplied. A4: production `judgements` service at commit `aff1a09`, default quick/deep mode from `ASK_RESEARCH`, `ASK_EFFORT_SIMPLE`/`ASK_EFFORT_COMPLEX` as set on that service (values not readable from here); answered in 35 s |
| Retrieved source texts and citation URLs | A1–A3 not supplied; numeric citation markers are preserved as pasted. A4 cited 10 sources, `[1]` being EFTA Court E-5/21 (`https://eftacourt.int/cases/e-5-21/`) |
| Verified reference answer | Not yet provided. The Court's operative part is quoted in *well-roadmap.md* §9a |
| Diagnostic status | **Confirmed, and the reviewer was right about the symptom and wrong only about its location.** See below |

### What A4 established

Added 14 September 2026 by the engineer, not the reviewer; the reviewer's own
comments above are untouched.

A4 was run to see whether anything had changed since A3. Nothing had: it
reports *"dómsorðið segir aðeins að dómstóllinn gefi ráðgefandi álit og síðan
er efnið fellt út"*, which is A3's complaint restated. That made it worth
finding out exactly what the model had been handed.

- **The corpus holds the judgment.** E-5/21 is stored as 29,149 characters
  including the full advisory opinion. The reviewer's inference — "it does not
  actually read the judgement but only some summary of it" — described the
  symptom precisely, but the summary was not what was stored, it was what
  survived truncation.
- **The operative part was being cut to its preamble.** The evidence budget for
  a holding was 800 characters against a median EFTA operative part of 868, so
  E-5/21's reached the model as the sentence "THE COURT … gives the following
  Advisory Opinion:" and an ellipsis. The reviewer read that back out of the
  answer in A3 almost verbatim.
- **The reasoning section was missing too**, because this judgment heads it
  "Answer of the Court" and the extractor knew only "Findings of the Court".

Both are fixed; §9a of *well-roadmap.md* carries the measurements. A5 should be
run against a deployment carrying those fixes, and is the first output that can
be compared like for like.

**The second half of the question is still open.** "Er búið að dæma í málinu
hjá Hæstarétti Íslands?" has an answer in the corpus — Hæstiréttur 24/2023,
28 February 2024, which cites "máli nr. E-5/21" by name — and retrieval does
not surface it, in quick mode or deep. That is a ranking defect, reproduced and
written up in §9a, and it is not fixed here. A5 will still be wrong about the
Icelandic proceedings.

**A1–A3 are datable by inference, not by record.** `isRegisterOnly` fires on a
1,551-character record and would have labelled it; none of A1–A3 carries such a
label, which places all three before that check shipped in #58. Recorded as an
inference because the runs themselves were not recorded.


## Q2 — Temporary employment contracts

Hvaða reglur gilda um umsögn tímabundnaráðningarsamninga? Má segja þeim upp? Hvaða skilyrði eru fyrir því að þeim sé hægt að segja upp? Eru til dómar um uppsögn tímabundnaráðningarsamninga á almennum vinnumarkaði? En opinberum?

### Evaluation table

Full outputs and reviewer comments are reproduced directly in the table, without summaries or collapsed sections.

| Question | Run | Full AI output | Comment | Rating (0–10) |
| --- | --- | --- | --- | --- |

### Evaluation context

| Field | Value |
| --- | --- |

