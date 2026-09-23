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
| Q2 | A1 | á, til eru dómar um tímabundnar ráðningar bæði á almennum vinnumarkaði og hjá hinu opinbera. Gögnin hér sýna þó ekki heildartexta þeirra laga sem gilda og gefa því ekki nægilegt grundvöll til að setja fram tæmandi reglur um heimildir til uppsagnar fyrir lok ráðningartíma eða skilyrði slíkrar uppsagnar.23Ákvæðin sem gildaLeitin bendir sérstaklega á lög um tímabundna ráðningu starfsmanna, lög nr. 139/2003, og lög um réttindi og skyldur starfsmanna ríkisins, lög nr. 70/1996.23Þar sem aðeins heiti laganna og fjöldi ákvæða kemur fram í heimildunum, en ekki sjálfur texti ákvæðanna, verður ekki ráðið af þessum gögnum nákvæmlega hvaða skilyrði gilda um gerð tímabundins samnings, endurnýjun hans eða uppsögn áður en samningstíma lýkur.23Dómarnir gefa helst upplýsingar um aðgreininguna milli þess að tímabundinn samningur renni út og þess að honum sé sagt upp. Í þeim gögnum sem hér liggja fyrir kemur ekki fram almenn regla um að tímabundnum samningi megi ávallt segja upp með uppsagnarfresti eða að slíkt sé ávallt óheimilt. (óstaðfest: engin heimild úr safninu styður þessa setningu)Hvað dómar sýna Á almennum vinnumarkaði var í Hæstarétti 345/2014 fjallað um sjómann sem hafði verið ráðinn með ellefu tímabundnum samningum. Hæstiréttur taldi hvorki að hann hefði öðlast rétt til launa í uppsagnarfresti við lok ráðningarinnar né að ítrekaðar ráðningar brytu gegn lögum nr. 139/2003; atvinnurekandinn var sýknaður.4Í Hæstarétti 149/2008 var skriflegur samningur ekki fyrir hendi. Af framkvæmd ráðningarsambandsins var ráðið að sjómaðurinn hefði verið ráðinn til tiltekinna veiðitímabila en ekki ótímabundið, og kröfu um laun í uppsagnarfresti var hafnað.8Hjá hinu opinbera fjallaði Hæstiréttur 127/2007 um árlegar tímabundnar ráðningar kennara í sérstakt deildarstjórastarf. Tímabundna ráðningin felldi ekki úr gildi ótímabundna skipun hennar í kennarastöðu, en Reykjavíkurborg var sýknuð af kröfu um biðlaun vegna þess sérstaka starfs.9Héraðsdómur Reykjavíkur E-4966/2021 fjallaði um hvort ótímabundinn samningur hefði stofnast eftir að starfsmaður hélt áfram störfum að loknum tímabundnum samningi og hvort honum hefði þá verið sagt upp með lögmætum hætti. Útdrátturinn sýnir ágreiningsefnið en ekki endanlega niðurstöðu.1Í áliti umboðsmanns í máli 88/2025 var kvartað yfir uppsögn tímabundins samnings nema við Háskóla Íslands. Umboðsmaður fjallaði ekki efnislega um lögmæti uppsagnarinnar þar sem kæruleið innan stjórnkerfis háskólans hafði ekki verið tæmd.6 | There are a few possitives here. It does point out a few interesting judgements   | |
| Q2 | A2 | Stutta svarið er að tímabundinn ráðningarsamningur rennur að jafnaði sjálfkrafa út við lok þess tímabils sem samið var um, en það er annað álitaefni en uppsögn áður en tímabilinu lýkur.58 Hjá ríkinu má aðeins segja tímabundnum samningi upp fyrir lok samningstíma ef það hefur verið tekið fram í ráðningarsamningnum.9 Á almennum vinnumarkaði sýna heimildirnar að ráðningarsamningur og kjarasamningur ráða miklu um þetta, en þær veita ekki eina almenna reglu sem svarar öllum tilvikum.62021 Tímabundnar ráðningar sæta jafnframt takmörkunum um hámarkslengd, endurnýjun og misnotkun endurtekinna samninga.47  Meginreglan: lok samningstíma og uppsögn fyrir lok hans  Tímabundin ráðning hjá ríkinu fellur sjálfkrafa úr gildi við lok samningstímans.512 Ef ekki hefur verið samið sérstaklega um uppsagnarrétt lýkur ráðningunni því við lok þess tímabils sem tilgreint er í samningnum, án þess að segja þurfi samningnum upp sérstaklega.8 Þetta þýðir þó ekki að ótímabundin eða tímabundin ráðning geti aldrei haldið áfram eftir lokadag. Í Landsrétti 735/2022 var talið að ráðningarsamband hefði haldið áfram eftir að tímabundinn samningur rann út, meðal annars vegna þess að starfsmaðurinn mætti samkvæmt vaktaplani, vinnuframlag hennar var tekið við og vinnuveitandinn gerði henni ekki ljóst að ekki ætti að þiggja frekara vinnuframlag hennar.5 Þá var ekki talið útilokað að nýtt ráðningarsamband stofnaðist þótt skriflegur samningur lægi ekki fyrir.5 Uppsögn fyrir lok samningstíma er því sjálfstætt álitaefni. Hjá ríkinu er lagaskilyrðið skýrt: í ráðningarsamningnum þarf að hafa verið tekið fram að heimilt sé að segja honum upp fyrir lok samningstímans.9  Hámarkslengd, endurnýjun og hlutlægar ástæður  Markmið laga nr. 139/2003 er meðal annars að tryggja að tímabundið ráðnir starfsmenn sæti ekki mismunun miðað við ótímabundið ráðna starfsmenn og að koma í veg fyrir misnotkun þar sem hver tímabundinn samningur tekur við af öðrum án hlutlægra ástæðna.4 Samkvæmt 5. gr. laganna er óheimilt að framlengja eða endurnýja tímabundinn ráðningarsamning þannig að ráðningin vari samfellt lengur en tvö ár, nema annað sé tekið fram í lögum.7 Í sama ákvæði er sérstök regla um stjórnanda sem ráðinn hefur verið til fjögurra ára eða lengri tíma, auk þess sem aðilum vinnumarkaðarins er heimilt að semja um annað fyrirkomulag um framlengingu eða endurnýjun í kjarasamningi.7 Nýr tímabundinn samningur telst taka við af eldri samningi ef hann er framlengdur eða ef nýr tímabundinn samningur kemst á milli sömu aðila innan sex vikna frá lokum eldri samnings.7 Hæstiréttur taldi í máli 218/2017 að nýr tímabundinn samningur sem gerður var daginn eftir að eldri samningur rann út félli innan þess tímamarka.13 Í máli Hæstaréttar 345/2014 hafði starfsmaður verið ráðinn með ellefu tímabundnum samningum á tilteknu tímabili. Dómurinn taldi hvorki að hann hefði öðlast rétt til uppsagnarfrests þegar síðasti samningurinn rann út né að ítrekaðar tímabundnar ráðningar hefðu brotið gegn lögum nr. 139/2003.6 Í dómi Hæstaréttar 218/2017 var jafnframt vísað til þess að hlutlægar ástæður ættu að ráða ákvörðun um tímabundna ráðningu samkvæmt 2. gr. laga nr. 139/2003.13 Í því máli var talið að tímabundnar heimildir Útlendingastofnunar til að ráða tvo starfsmenn væru slíkar hlutlægar ástæður.13 (óstaðfest: engin heimild úr safninu styður þessa setningu)  Almennur vinnumarkaður: má segja samningnum upp?  Heimildirnar sem liggja fyrir innihalda ekki útdrátt úr almennu lagaákvæði sem kveður með almennum hætti á um hvort tímabundnum ráðningarsamningi á almennum vinnumarkaði megi segja upp fyrir lok samningstíma. Þær sýna hins vegar að skýring ráðningarsamningsins, uppsagnarákvæði hans og kjarasamningur geta ráðið úrslitum.202123 Í Félagsdómi F-22/2020 var deilt um hvort Icelandair hefði mátt draga til baka tilkynnta framlengingu tímabundinna ráðningarsamninga án greiðslu launa eða bóta.23 Stefnandi hélt því fram að kjarasamningur gerði ráð fyrir því að uppsagnarákvæði giltu um ótímabundna samninga en ekki samninga þar sem lokadagur væri tiltekinn, og að slíkir tímabundnir samningar væru því óuppsegjanlegir.23 Félagsdómur leysti þó ekki úr þessari efnislegu spurningu; málinu var vísað frá þar sem álitaefnið laut að því hvort ráðningarsamningur hefði yfirhöfuð stofnast og það félli utan verksviðs Félagsdóms, auk þess sem dómurinn taldi sig ekki eiga að leysa úr meintu broti gegn lögum nr. 139/2003.23 (óstaðfest: engin heimild úr safninu styður þessa setningu) Nýlegir dómar um Hval hf. sýna síðan að niðurstaðan getur ráðist af því hvaða réttindi samningur og kjarasamningur veita: Í Héraðsdómi Vesturlands E-231/2025 var talið að ráðningarsamningur hefði komist á vegna hvalvertíðar. Þótt ráðningin gæti ekki komið að fullu til framkvæmda vegna þess að veiðar hófust ekki á fyrirhuguðum tíma, var vinnuveitandanum gert að greiða laun á uppsagnarfresti. Dómurinn taldi hvorki sjónarmið um force majeure, brostnar forsendur né önnur tilgreind lagaákvæði hagga þeirri skyldu.14Sama niðurstaða kemur fram í Héraðsdómi Vesturlands E-233/2025, þar sem talið var að ráðningarsamband hefði komist á og vinnuveitandinn bæri skyldu til að greiða laun á uppsagnarfresti þótt forsendur fyrir hvalvertíðinni hefðu breyst.21Í Héraðsdómi Vesturlands E-320/2025 var Hvalur hins vegar sýknaður á þeim grundvelli að samningurinn veitti starfsmanninum ekki rétt til annars en þess uppsagnarfrests sem honum var tryggður samkvæmt kjarasamningi þegar uppsagnarbréf barst.20 Í Héraðsdómi Vesturlands E-319/2025 var komist að sömu niðurstöðu.22Þessir dómar benda ekki allir í sömu átt í niðurstöðu sinni, en munurinn virðist meðal annars tengjast efni einstakra samninga, því hvaða kröfur voru gerðar og hvaða uppsagnarfrestur leiddi af kjarasamningi.14202122 Af þeim verður því ekki dregin sú almenna ályktun að allir tímabundnir samningar á almennum vinnumarkaði séu annaðhvort uppsegjanlegir eða óuppsegjanlegir. Í Héraðsdómi Reykjavíkur E-835/2016 og E-830/2016 var deilt um laun í uppsagnarfresti vegna ráðningarsamninga sjómanna sem tilgreindu ákveðið ráðningartímabil.2526 Útdrættirnir sem liggja fyrir sýna ekki forsendur eða dómsorð um það álitaefni og því verður ekki sagt af þeim dómum hvaða efnisreglu dómstóllinn byggði niðurstöðu sína á.2526Hið opinbera: skilyrði fyrir uppsögn tímabundins samningsLög nr. 70/1996 gera ótímabundna ráðningu að meginreglu fyrir ríkisstarfsmenn, með gagnkvæmum þriggja mánaða uppsagnarfresti að loknum reynslutíma nema annað sé samið í kjarasamningi.9 Heimilt er þó að ráða starfsmann tímabundið, og í ráðningarsamningi má taka fram að segja megi samningnum upp af hálfu annars hvors aðila áður en hann fellur sjálfkrafa úr gildi við lok samningstímans.9 Helstu skilyrðin samkvæmt heimildunum eru því þessi:Tímabundinn samningur þarf að vera heimill og ráðningin má almennt ekki vara samfellt lengur en tvö ár.79Uppsagnarréttur fyrir lok samningstíma þarf að byggjast á samningnum, en ekki eingöngu á því að ráðningin sé tímabundin.9Skriflegur ráðningarsamningur skal gerður, en skortur á undirrituðum samningi útilokar ekki sjálfkrafa að ráðningarsamband hafi stofnast.512Ef samningurinn er framlengdur í verki eða starfsmaður heldur áfram störfum með samþykki vinnuveitanda getur nýtt eða framlengt ráðningarsamband stofnast.5Við uppsögn þarf eftir atvikum að gæta þeirra verndarreglna sem gilda um opinbera starfsmenn, svo sem reglna um skriflega áminningu.24Dómar um uppsögn hjá hinu opinbera### Landsréttur 310/2018 Í Landsrétti 310/2018 var starfsmaður ráðinn tímabundið sem aðstoðarskólameistari til tiltekins lokadags.24 Landsréttur taldi heimilt að ráða hann tímabundið og heimilt að taka fram í samningnum að segja mætti honum upp fyrir lok samningstímans.24 Dómurinn taldi jafnframt að ákvæði um eins mánaðar uppsagnarfrest á þriggja mánaða reynslutíma ætti aðeins við um starfsmenn sem ráðnir væru ótímabundið en ekki um þennan tímabundna samning.24 Samkvæmt dómsúrdrættinum var uppsögnin engu að síður talin ólögmæt vegna þess að ekki hafði verið gætt reglna laga nr. 70/1996 um skriflega áminningu.24 Málið sýnir því að samningsbundinn uppsagnarréttur leysir ekki sjálfkrafa vinnuveitanda undan öðrum lagaskyldum við uppsögn.24 ### Hæstiréttur 218/2017 Í Hæstarétti 218/2017 var starfsmaður fyrst ráðinn tímabundið til tiltekins dags og síðan varð munnlegt samkomulag um nýjan tímabundinn samning.13 Dómurinn taldi að ekki hefði stofnast ótímabundið ráðningarsamband eftir að sá samningur rann út, meðal annars þar sem gögn málsins bentu ekki til þess að til stæði að ráða starfsmanninn ótímabundið og nýr tímabundinn samningur hafði verið lagður fyrir hana.13 Þegar starfsmaðurinn neitaði endanlega að undirrita samninginn taldi dómurinn að svar hennar yrði að skilja sem neitun á starfstilboðinu og uppsögn hennar á því ráðningarsambandi sem aðilar töldu vera í gildi.13 Ríkið var því sýknað af kröfum um bætur vegna ólögmætrar uppsagnar og laun í uppsagnarfresti.13 ### Landsréttur 735/2022 Í Landsrétti 735/2022 var deilt um hvort tímabundin ráðning hefði lokið eða haldið áfram eftir lokadag.5 Starfsmaðurinn hafði mætt samkvæmt vaktaplani eftir lok samningstímans og vinnuveitandinn tekið við vinnuframlagi hennar án athugasemda.5 Landsréttur staðfesti þá niðurstöðu að ráðningarsambandið hefði verið framlengt þótt ekki hefði verið gerður nýr skriflegur samningur.5 Málið snerist ekki um hefðbundna uppsögn fyrir lok samningstíma, en það er mikilvægt um það hvenær vinnuveitandi getur ekki lengur byggt á því að eldri tímabundinn samningur hafi einfaldlega runnið út.5 ### Héraðsdómur Reykjavíkur E-3228/2009 Í Héraðsdómi Reykjavíkur E-3228/2009 hafði framhaldsskólakennari verið ráðinn tímabundið ítrekað.11 Dómurinn taldi að hann hefði átt rétt á ótímabundinni ráðningu þegar honum var boðinn enn einn tímabundinn samningur eftir tveggja ára samfellt starf.11 Sú ákvörðun að bjóða honum aðeins tímabundinn samning var talin ólögmæt og ríkinu gert að greiða honum bætur á þeim grundvelli.11 Dómurinn taldi þó jafnframt að starfsmaðurinn hefði ekki sjálfkrafa haft stöðu fastráðins starfsmanns vegna þess eins að ekki hefði verið gengið frá ótímabundnum samningi.11 Þess vegna var kröfu hans um laun í uppsagnarfresti hafnað.11 Dómurinn greinir þannig á milli réttar til ótímabundinnar ráðningar og þess að ótímabundið ráðningarsamband hafi þegar stofnast með þeim afleiðingum að uppsagnarfrestur sé sjálfkrafa greiddur.11 ### Önnur opinber mál Í úrskurði um Kópavogsbæ, IRR11030398, var miðað við að starfsmaður sem upphaflega hafði verið tímabundið ráðinn hefði síðar verið fastráðinn.16 Uppsögn hans vegna skipulagsbreytinga og hagræðingar var látin standa, enda taldi ráðuneytið að breytingarnar hefðu verið faglega undirbúnar og byggðar á málefnalegum sjónarmiðum.16 Þetta var því ekki dæmi um uppsögn á virkum tímabundnum samningi heldur ágreiningur um hvort tímabundin ráðning hefði síðar breyst í ótímabundna ráðningu.16 Í máli Hafnarfjarðarbæjar, IRR11040243, hafði starfsmaður verið ráðinn tímabundið ár eftir ár í tæp fimm ár og var henni síðan tilkynnt að nýr samningur yrði ekki gerður.10 Kröfu um að ráðuneytið úrskurðaði að henni hefði ólögmætlega verið synjað um fastráðningu eða endurnýjun var hafnað.10 Úrskurðurinn fjallar því einkum um lok eða endurnýjun tímabundinnar ráðningar en ekki um uppsögn fyrir lok tiltekins samningstíma.10 Umboðsmaður Alþingis fjallaði í máli 88/2025 um kvörtun vegna uppsagnar á tímabundnum ráðningarsamningi nema við Háskóla Íslands sem stundaði verklegt nám á Landspítalanum.19 Málinu var þó lokið án efnislegrar niðurstöðu þar sem ákvörðun deildarforseta hafði ekki verið borin undir háskólaráð og endanleg afstaða stjórnvaldsins lá því ekki fyrir.19  Hvað heimildirnar svara ekki  Heimildirnar gefa ekki fulla mynd af öllum reglum almennra kjarasamninga um uppsagnarfrest tímabundinna ráðningarsamninga.202123 Þær sýna heldur ekki útdrátt úr öllum ákvæðum laga nr. 139/2003 eða laga nr. 55/1980, þannig að ekki er unnt að setja hér fram tæmandi reglur um mismunun, skriflegar upplýsingar, sérreglur einstakra atvinnugreina eða réttaráhrif brota.1347 Til að svara tilteknu álitaefni á almennum vinnumarkaði þyrfti því sérstaklega að leita að viðeigandi kjarasamningi, ákvæði ráðningarsamnings um uppsagnarfrest og dómum um þá atvinnugrein sem málið varðar.2021 Fyrir opinberan starfsmann þarf að skoða ráðningarsamninginn, kjarasamninginn og þær sérstöku málsmeðferðarreglur sem kunna að gilda um uppsögnina.924 | We miss some key case law here but this is the best output to date. Moveing into a possitive direction and has clearly outpreformed other tests| |

### Evaluation context

| Field | Value |
| --- | --- |
| Rating status | A1 awaits rating |
| Actual test dates | Not supplied |
| Model / configuration / application commit | Not supplied. `ASK_RESEARCH` is set on the production service, so A1 was most likely a deep run — which is the fact that made the diagnosis below necessary |
| Retrieved source texts and citation URLs | Not supplied; numeric citation markers are preserved as pasted |
| Verified reference answer | The reviewer supplied one, together with the acts and judgments they expect the well to find. Reproduced below as the target, not as a verified legal conclusion |
| Diagnostic status | **Confirmed against the code, not against a run.** See below |

### What the reviewer expects to be found

Supplied by the reviewer with the question. Recorded here as the target for A2,
so that "did it find these" is a check rather than an impression.

**Legislation**

- lög um starfsmenn í hlutastörfum
- lög nr. 70/1996 um réttindi og skyldur starfsmanna ríkisins, and 41. gr. in
  particular: *"Heimilt er að ráða starfsmann til starfa tímabundið og er unnt
  að taka fram í ráðningarsamningi að segja megi slíkum samningi upp af hálfu
  annars hvors aðila áður en ráðning fellur sjálfkrafa úr gildi við lok
  samningstíma. Tímabundin ráðning skal þó aldrei vara samfellt lengur en í tvö
  ár."*
- lög um kjarasamninga opinberra starfsmanna
- lög um rétt verkafólks til uppsagnarfrests frá störfum og til launa vegna
  sjúkdóms- og slysaforfalla

Kjarasamningar themselves are **not in the corpus**, and this question turns on
them. That is a coverage gap, not a retrieval defect, and the answer should say
so rather than work around it.

**Judgments**

| Decision | What it is authority for |
| --- | --- |
| Héraðsdómur Reykjaness 11. júní 2024, E-2997/2023 — Sandra Sif Baldursdóttir gegn Sjóklæðagerðinni hf. | An agreed termination clause in a fixed-term contract is effective |
| Hrd. 23. september 2021, 15/2021 — A gegn B ses. | The termination right can come from a kjarasamningur; having it does not make a particular dismissal lawful |
| Hrd. 13. desember 2012, 256/2012 — Kristján B. Þórarinsson gegn Valitor hf. | A fixed term that has run its course ends without notice, so no notice pay |
| Landsréttur 1. mars 2019, 310/2018 — Hafliði Páll Guðjónsson gegn íslenska ríkinu | A fixed-term contract can be terminable, but the wording of the probation clause and the statutory procedure decide it |

Two are private-sector, two public, and the reviewer's own method for telling
them apart — an ehf. or an hf. against íslenska ríkið or a municipality — is now
`sectorOf` in `src/lib/ask/tools.ts`.

### What A1 established

Added 16 September 2026 by the engineer; the reviewer's comment above is
untouched.

The reviewer's summary of the whole feature — *"it is all very surface level and
only seems to run on summaries"* — is accurate, and A1 shows it: it names four
decisions and an ombudsman opinion, says of one of them only that *"útdrátturinn
sýnir ágreiningsefnið en ekki endanlega niðurstöðu"*, and reports that the
sources do not carry the text of the acts. None of the four judgments the
reviewer expects is among them.

The tempting diagnosis was that deep research was switched off. It was not.
`ASK_RESEARCH` is set on the production service and the loop had been running.
What was wrong is written up in *well-roadmap.md* §9b; in short:

- **The answer prompt could not hold a research answer.** *"Around 250-450
  words"*, *"no tables"*, and a fixed three-section shape. The reviewer's model
  answer is ~1,400 words with two tables and a public/private split running
  through it. No retrieval could have produced that through that prompt.
- **`select` capped what the loop read at the quick path's ten sources.** The
  loop may open 25 documents; fifteen of them were being ranked, cut, and never
  shown to the model.
- **Every judgment arrived at 2,000 characters of reasoning**, four-minute run
  or ten-second one, because the per-part budgets were constants rather than
  configuration. Two thousand characters of a thirty-page judgment is the first
  two paragraphs of the Niðurstaða — which is, quite literally, running on
  summaries.
- **The loop had no way to ask the question a lawyer asks second.**
  `CaseProvisionLink` records which judgments cite which article and was
  unreachable from the well. For this question that is the whole game: find 41.
  gr. laga nr. 70/1996, then read the graph out of it. `cases_citing_provision`
  does that now, and `read_act_outline` finds the article in the first place —
  41. gr. never uses the phrase anyone would search for.
- **The loop could stop whenever it liked.** `research_complete` now has to be
  called and is checked: law read, decisions opened, and both sides of a
  question that asks about both labour markets. This question is the reason
  that last check exists.

All of the above is fixed. **None of it is measured.** A2 is the first output
that can be compared, and it should record its model, effort settings and
commit — the run itself is the evidence, not the reasoning above.

### What A2 established

Added 16 September 2026 by the engineer; the reviewer's comment above is
untouched. A2 is the first output in this file that can be compared with
another like for like, because it is the first with its configuration recorded.

**The budget change took effect, and the output proves it.** A2 cites source
numbers up to 26. Under the previous `maxSources` of 10 no number above 10
could exist, so the deep tier's wider source budget is demonstrably reaching
the answer. A1 cited nine.

**Against the reviewer's target list.**

| Expected | A2 |
| --- | --- |
| Landsréttur 310/2018 — Hafliði Páll Guðjónsson gegn íslenska ríkinu | **Found**, and read properly: the probation-clause point, and that the dismissal was still unlawful for want of a written áminning |
| Héraðsdómur Reykjaness E-2997/2023 — Sjóklæðagerðin hf. | Missed |
| Hrd. 23. september 2021, 15/2021 — A gegn B ses. | Missed |
| Hrd. 13. desember 2012, 256/2012 — Valitor hf. | Missed |
| lög nr. 70/1996, 41. gr. | **Found** in substance — fixed-term appointment permitted, terminable only where the contract says so, two-year limit |
| lög nr. 139/2003 | **Found**, including 5. gr.'s two-year ceiling and the six-week chaining rule |
| lög um starfsmenn í hlutastörfum | Missed |
| lög um kjarasamninga opinberra starfsmanna | Missed |
| lög nr. 19/1979 (uppsagnarfrestur verkafólks) | Missed. A2 names lög nr. 55/1980 instead, which is a different act |

So one of four expected judgments and two of four expected acts. That is the
number to beat, and it is not yet good enough.

**What it found that was not on the list**, and which the reviewer has not yet
assessed: Landsréttur 735/2022, Hrd. 218/2017, Hrd. 345/2014, Félagsdómur
F-22/2020, four Héraðsdómur Vesturlands judgments about Hvalur hf. from 2025
(E-231/2025, E-233/2025, E-319/2025, E-320/2025), Héraðsdómur Reykjavíkur
E-3228/2009, E-835/2016 and E-830/2016, two ministry rulings (IRR11030398,
IRR11040243) and UA 88/2025. Whether that breadth is worth the space is a
question for the reviewer; the four Hvalur judgments in particular are recent,
squarely on the point, and A2 notices that they do not all come out the same way
and says why — which is rule 4 of the answer prompt working.

**The shape the deep tier asks for is there.** Public and private are separate
sections, conditions are listed as conditions, and there is a closing section on
what the sources do not answer. A1 had none of that.

### Three defects visible in A2

**1. Third-level headings are not rendered.** `src/lib/ask/render.ts` understands
`## ` and nothing else, and the deep tier's answers now have enough structure
that the model reaches for `### `. The paste shows this exactly: the second-level
headings arrive as plain lines, because they rendered as headings and copying
gave the text — while "### Landsréttur 310/2018", "### Hæstiréttur 218/2017",
"### Landsréttur 735/2022", "### Héraðsdómur Reykjavíkur E-3228/2009" and
"### Önnur opinber mál" arrive with their hashes attached and run together into
one wall of text, because the renderer never recognised them. The whole
"Dómar um uppsögn hjá hinu opinbera" section is one paragraph on screen.

This is the single biggest legibility problem in A2 and it is a small fix:
accept `### ` as a sub-heading in the renderer, or tell the deep prompt there is
only one heading level. Accepting it is better now the answers are long.

**2. No table was used**, although the deep prompt offers one and the case
sections are exactly where the reviewer's own model answer uses two. The prompt
says "where one genuinely reads better than prose" and "do not put the main
analysis in a table", which may be reading as discouragement. Worth one revision
of that wording before concluding the tables do not work.

**3. The unsupported-claim marker fired twice.** Both instances sit at the end of
a paragraph that does carry citations, which in `validateCitations` means only
one thing: the sentence cited a source number that did not exist, the marker was
deleted, and the sentence was qualified. That is the validator working exactly as
designed — but it means the model invented at least two source numbers, and
raising the ceiling from 10 to 28 gives it more numbers to confuse. Both
qualified sentences look substantively plausible, which is the cost: a correct
sentence carrying a warning.

Checkable in one look: the metrics line for that request records
`validation.nonexistentCitations`. If it is 2, this reading is confirmed. Worth
watching across the next few runs — if it is routine, the answer prompt should
name the valid range explicitly.

### Why Sjóklæðagerðin was missed — hypotheses, none verified

Unverified, and listed so the next person does not start from nothing:

- **It may not be in the corpus.** Héraðsdómur Reykjaness, 11 June 2024. The
  check is one search of the corpus for `E-2997/2023`, and it should be done
  before anything else — a retrieval fix for a document that is not there is
  wasted work.
- **If it is there, the citation graph may not reach it.** `cases_citing_provision`
  only finds a judgment whose citations our parser resolved. A judgment that
  turns on a contractual clause referring to a kjarasamningur may cite no article
  the graph holds.
- **The case-number ranking defect in §9a of *well-roadmap.md* is still open**,
  and `find_citing_cases` runs on that same search.

The same three apply to Hrd. 15/2021 and Hrd. 256/2012. Note that A2 did find
several héraðsdómar, including four from 2025, so first-instance judgments are
clearly reachable in general — which makes a corpus gap the more likely
explanation for this particular one, and makes the search worth running first.

## Q3 — A de facto restriction on moving with a disabled child

have a hypothisis that there is a defacto restriction on the free movement of people with disabled children. My theory is this, a state can intoduce a requirement that require some sort of connection to the state, the parent then moves abrod and the child comes along. This leads to the situation that the child does not fulfill the requirements to gain benefits in his new state and also loses the benefits in his home state, ergo there becomes a restriction. Can you check in light of CJEU caselaw and specifically reg 883/2004 if this is a situation that might occur

Asked in English, unlike Q1 and Q2, and answered in English. The first question
here that is EU/EEA law rather than Icelandic law, and the first with an
external comparator.

### Evaluation table

Full outputs and reviewer comments are reproduced directly in the table, without
summaries or collapsed sections. **B1 is not the well.** It is an answer to the
same question from LegalCode MCP, run by Fordæmi, supplied by the reviewer as a
comparator. It is recorded in the same table because the comparison is the
evidence; it is not a run of this application and must not be counted as one in
any average.

| Question | Run | Full AI output | Comment | Rating (0–10) |
| --- | --- | --- | --- | --- |
| Q3 | A1 | Direct answer<br>Yes in principle, but the answer turns entirely on how the benefit is classified under Regulation (EC) No 883/2004, and the sources in this well do not contain the CJEU case law on disability and care benefits for children that would settle it. Where the benefit is a "special non-contributory cash benefit" listed in Annex X, the Regulation itself authorises the residence condition: such benefits are provided "exclusively in the Member State in which the persons concerned reside", and Article 7 (waiving of residence rules) and the other chapters of that Title are disapplied to them6. Where the benefit is *not* an SNCB, or where the coordination provision does not exhaustively govern the situation, the Court of Justice has been willing to go behind the Regulation and require a Member State to take account of the consequences of a move directly under Article 21 TFEU — that is the ratio of C-576/20 *CC v Pensionsversicherungsanstalt*, although the Court attached a condition of exclusive connection with the State concerned19. In the EEA, the EFTA Court has stated the underlying principle plainly: migrant workers must not lose their right to social security benefits or have them reduced because they have exercised their right to free movement, and free movement is impeded if an EEA national is placed at a disadvantage in the State of origin solely for having exercised that right27. (unverified: no retrieved source supports this sentence) The specific scenario you describe — a disabled child accompanying a moving parent, falling between two systems — is not addressed in any source before me, and I say below what would answer it.<br><br>What the Regulation coordinates, and where a disability or care benefit sits<br>Article 3(1) lists the branches covered, including sickness benefits, invalidity benefits and family benefits5. The Regulation applies to general and special schemes, contributory or non-contributory, unless Annex XI provides otherwise, and also to the special non-contributory cash benefits covered by Article 705. It does not apply to social and medical assistance5. For the purposes of Title III, Chapter 1 (sickness, maternity and equivalent paternity benefits), "benefits in kind" was defined by Regulation (EC) No 988/2009 to include long-term care benefits in kind7 — relevant because care provision for a disabled child may fall on either side of the cash/in-kind line. That classification exercise is the first thing a case of this kind turns on, and the sources here give the criteria but no application of them to a child's care allowance.<br><br>The SNCB carve-out: where a residence condition is expressly permitted<br>Article 70 applies to benefits whose legislation has characteristics both of the social security legislation in Article 3(1) and of social assistance6. A benefit is an SNCB only if it cumulatively satisfies three conditions6:<br><br>Condition	Content<br>Purpose	Either supplementary/substitute/ancillary cover guaranteeing a minimum subsistence income, or "solely specific protection for the disabled, closely linked to the said person's social environment in the Member State concerned"6<br>Financing	Exclusively from compulsory taxation for general public expenditure, with grant and calculation not dependent on any contribution in respect of the beneficiary6<br>Listing	Listed in Annex X6<br>Two consequences follow, and both cut against the person moving. Article 70(3) provides that Article 7 and the other chapters of that Title do not apply to SNCBs6. Article 70(4) provides that they are to be provided exclusively in the Member State of residence, in accordance with its legislation, by and at the expense of the institution of the place of residence6. So for a listed SNCB, the very outcome described in the question — loss on departure, with the host State becoming the only debtor — is the design of the Regulation, not a defect in it. Note that the second limb of Article 70(2)(a) expressly contemplates benefits giving "solely specific protection for the disabled, closely linked to the said person's social environment"6. Disability-specific benefits are therefore one of the two categories the SNCB regime was written for, which is why the Annex X listing question is decisive rather than incidental. The classification also has knock-on effects elsewhere: in C-151/24 the Court held that Article 12(1)(e) of Directive 2011/98 does not apply to a benefit that is an SNCB within the meaning of Article 70 of Regulation No 883/2004, so that a Member State could make the grant of an old-age social allowance subject to holding an EU long-term residence permit21. That case concerns third-country nationals and equal treatment, not free movement of Union citizens, but it illustrates that the Article 70 label removes a benefit from regimes that would otherwise bite. Because the extract of Article 70 before me is complete for paragraphs 1–4, but Article 7 itself is not among the sources, I cannot set out the content or the limits of the exportability rule that Article 70(3) disapplies. (unverified: no retrieved source supports this sentence)<br><br>The primary-law route: C-576/20 *CC*<br>This is the most directly transferable authority in the pack for the proposition that a gap left by the coordination rules can still be a restriction. The applicant had worked and paid contributions only in Austria, then moved and raised children in Belgium and Hungary. Article 44(2) of Regulation No 987/2009 requires the person to have been pursuing an activity as an employed or self-employed person in the Member State concerned at the date when, under that State's legislation, the child-raising period started to be taken into account; on the relevant Austrian dates she was not19. (unverified: no retrieved source supports this sentence) The Court reformulated the referred question of its own motion so as to bring in Article 21 TFEU, observing that it may interpret all provisions of EU law needed to decide the case even where the referring court has not mentioned them19. It framed the decisive issue as whether Article 44 governs the matter exclusively: if it does, the periods can be taken into account only under it and Article 21 TFEU does not apply; if it does not, the *Reichel-Albert* line — requiring a Member State to take account under Article 21 TFEU of child-raising periods completed in other Member States — may extend to a situation falling within the temporal scope of the implementing Regulation but not satisfying its conditions19. The holding: where the person does not fulfil the Article 44(2) condition, the Member State responsible for the pension is required to take account of those periods pursuant to Article 21 TFEU, provided that the person worked and paid contributions exclusively in that Member State both before and after transferring residence to the other Member State where the child-raising took place19. What that is authority for, and its limits:<br><br>Secondary coordination law is not automatically exhaustive; a condition in the Regulation that defeats entitlement does not by itself close the case19.<br>A disadvantage suffered because the person moved can engage Article 21 TFEU directly19.<br>But the remedy was conditioned on an exclusive connection with the paying State — the Court did not announce a free-standing rule that any loss on moving must be made good19.<br>It is a pension/child-raising-periods case, not a disability or care benefit case, and it concerns the *former* State being obliged to take a cross-border fact into account, not a claimant falling between two systems.<br>The EEA dimension<br>Regulation (EC) No 883/2004, Regulation (EC) No 988/2009 and Regulation (EC) No 987/2009 were incorporated into Annex VI to the EEA Agreement by EEA Joint Committee Decision No 76/201114. In E-3/23 *A v Arbeids- og velferdsdirektoratet* the EFTA Court set out the governing principles at some length. EEA law coordinates rather than harmonises: in the absence of harmonisation it is for each EEA State's legislature to determine the conditions on which social security benefits are granted, but in exercising that power the States must comply with EEA law27. The objective pursued by Article 29 EEA entails that migrant workers must not lose their right to social security benefits or have the amount of those benefits reduced because they have exercised their right to free movement, and the right to free movement would be impeded if an EEA national were placed at a disadvantage in his or her State of origin solely for having exercised that right27. The Court also confirmed that invalidity benefits fall within the material scope of the Regulation under Article 3(1)(c), and that Articles 4 to 6 lay down the key principles of equality of treatment and aggregation of periods27. The actual holding in E-3/23 concerns what constitutes a "minimum benefit" under Article 5827, so those passages are reasoning of general application rather than a ruling on the present problem. E-26/25 *Mohr-Egger* adds that Title II is a complete and uniform system of conflict rules intended not only to prevent the simultaneous application of several national systems but also to ensure that persons covered by the Regulation are not left without social security cover because there is no legislation which is applicable to them, and that the unrestricted application of the general rule might in certain situations impede freedom of movement26. That reasoning goes to *which* legislation applies, not to whether the applicable legislation's entitlement conditions are satisfied. On the latter, recital 17a inserted by Regulation (EC) No 988/2009 states that once a Member State's legislation becomes applicable under Title II, the conditions for affiliation and entitlement to benefits are to be defined by the legislation of the competent Member State "while respecting Community law"7 — the qualification is the hook for any de facto restriction argument.<br><br>Adjacent route: cross-border healthcare<br>Directive 2011/24/EU is a different instrument and applies without prejudice to Regulation No 883/200413. It provides that the Member State of affiliation may decide to reimburse other related costs, such as accommodation and travel, "or extra costs which persons with disabilities might incur due to one or more disabilities when receiving cross-border healthcare", in accordance with national legislation and subject to sufficient documentation13 — a discretion, not an obligation. It also provides that conditions and formalities imposed by the State of affiliation may not be discriminatory or constitute an obstacle to the free movement of patients, services or goods unless objectively justified on planning or cost-control grounds13. This covers healthcare costs, not disability or care allowances, and does not answer the question.<br><br>What the sources do not cover, and what would answer the question<br>Stated plainly, the following limbs are unanswered by the material before me:<br><br>No case on a disabled child's care or disability benefit. None of the nine decisions concerns disability allowances, care allowances, or children at all as beneficiaries; the CJEU decisions here concern A1 certificates and the dialogue and conciliation procedure1723, child-raising periods for a pension19, currency conversion of child allowance25, and an old-age social allowance for a third-country national21.<br>No treatment of derived rights of family members. Whether a child can rely on a parent's insurance in the competent State, and the interaction with Article 70's residence rule, is simply not in the sources. (unverified: no retrieved source supports this sentence)<br>Article 7, Annex X and the family-benefits chapter are not before me. I have Article 70's cross-reference to Article 76 and the amendment of Article 63 restricting Article 7 in the unemployment chapter12, but not the text of Article 7, Article 67, or any Annex X entry.<br>No "genuine link" / residence-condition case law. The proportionality test applied to home-State residence or connection requirements is not represented.<br>To answer the question properly, the searches worth running are: Article 7 and Annex X of Regulation (EC) No 883/2004 (exportability and the SNCB list); Article 67 and the family-benefits chapter; CJEU case law classifying care allowances as sickness benefits in cash rather than SNCBs; case law on derived entitlement of family members of an insured person; and Article 21 TFEU / Article 45 TFEU case law on home-State residence and connection conditions and their justification. The EFTA Court's *Einarsdóttir* judgment, cited in E-3/23 for the proposition that a person must not be disadvantaged in the State of origin for having moved27, is a further obvious target for the EEA side of the analysis. | Reviewer: "A super strange thing here is that they cite that E-3/23 refers to Einarsdóttir judgement (E-5/21). It feels very strange." Supplied B1 alongside, with: "this is an answwer that I got from LegalCode MCP run by Fordæmi … could be a very good start to a reasurch session - but our project is realy moveing in the right direction." | |
| Q3 | B1 | a loss of support of that kind can occur, and the CJEU has recognised closely related barriers. But the existence of a benefit gap does not, by itself, establish an unlawful restriction. The decisive questions are what kind of benefit is involved, which State remains responsible, and whether the connection requirement survives the coordination and free-movement rules.<br>Your hypothesis is therefore plausible, but its starting premise needs qualification: a State cannot simply impose any residence or connection requirement it chooses.<br>How Regulation 883/2004 addresses the gap<br>"Disability benefits" are not a single category under the Regulation. Depending on their purpose and eligibility conditions, support can constitute sickness benefits, invalidity benefits, family benefits, special non-contributory cash benefits, or assistance outside the Regulation.<br>The relevant safeguards in Regulation 883/2004 are:<br>Provision	Significance for your hypothesis<br>Article 4 — equal treatment	A migrant within the Regulation's scope generally has the same benefit rights as nationals, subject to applicable exceptions.<br>Article 5 — assimilation of facts and events	A requirement linked to a particular event may require recognition of an equivalent event occurring in another Member State.<br>Article 6 — aggregation	Where entitlement depends on insurance, employment or residence periods, relevant periods completed under another Member State's legislation generally must count. A territorial waiting period cannot simply be assumed valid.<br>Article 7 — waiver of residence rules	Covered cash benefits generally cannot be withdrawn merely because the beneficiary or family members live in another Member State.<br>Article 70 — special non-contributory cash benefits	A significant exception: qualifying benefits listed in Annex X are generally payable only in the State of residence, under its legislation.<br><br>Two qualifications matter particularly.<br>First, Article 7 is not a guarantee that the original State remains responsible forever. A move accompanied by a change of employment or insurance can change the applicable legislation. Withdrawal solely because of residence abroad must be distinguished from entitlement ending following a lawful change of competent State.<br>Second, Article 70 does not disapply Article 6. Consequently, even where the original benefit is non-exportable, a host-State qualifying-period requirement still needs examination under aggregation rules. "Non-contributory" also does not automatically mean "non-exportable": the Article 70 conditions, including Annex X listing, must be satisfied.<br>The closest cases<br>1. Stewart, C-503/09: a disabled daughter moves abroad with her parents<br>This is particularly close to your factual hypothesis. Lucy Stewart, who had Down's syndrome, moved from the UK to Spain with her parents. When she reached 16, her claim for UK incapacity benefit in youth was refused because she did not satisfy the territorial presence conditions.<br>The Court held that:<br>- The benefit was an invalidity benefit, despite its "short-term" label.<br>- The ordinary-residence requirement was precluded by Regulation 1408/71, the predecessor to Regulation 883/2004.<br>- A past-presence condition was disproportionate because it excluded other ways of establishing a genuine connection.<br>Crucially, the Court treated her parents' pensions and previous links to the UK social-security system as relevant to her own connection, alongside her existing entitlements and residence history: paragraphs 95-104, particularly 100-102. EUR-Lex<br>For your argument, that means a disabled child's connection cannot necessarily be assessed in isolation from the parents. However, Stewart concerned entitlement against the State of origin, not a general obligation on every destination State to pay immediately.<br>2. Städteregion Aachen, C-257/24, judgment of 10 July 2025: disability support and the parent's worker status<br>In this judgment, a disabled child lived in Belgium, attended school in Germany, and had a mother working in Germany. German authorities refused school assistance because the child resided abroad.<br>The Court held that the assistance fell outside Regulation 883/2004, given its individual needs assessment. Nevertheless, the residence requirement infringed Article 7(2) of Regulation 492/2011, governing workers' social advantages.<br>The reasoning is directly relevant:<br>- Paragraphs 44-45: the requirement constituted indirect discrimination and a restriction on workers' free movement.<br>- Paragraphs 49-50: the parent's employment and tax/social contributions supplied a genuine and sufficient connection.<br>- Paragraph 52: the child's residence requirement was disproportionate.<br>This directly supports the proposition that a restriction imposed on a disabled child's support can restrict the parent's free movement. Its factual limit is that the parent continued working—and the child attended school—in the State providing assistance.<br>3. Hendrix, C-287/05: non-exportability does not end the analysis<br>In Hendrix, the Court accepted that a benefit for disabled young people was a special non-contributory benefit, generally subject to residence.<br>Nevertheless, its application remained subject to workers' free-movement rights. The national court had to examine proportionality, particularly the claimant's continuing economic and social links to the paying State: paragraphs 51-58.<br>Thus, an exception to exportability under the coordination Regulation is not automatically a complete defence to a free-movement challenge.<br>*4. A (Assistance for a disabled person), C-679/16: protection outside the Regulation*<br>In this case, personal assistance supporting a severely disabled person's higher education fell outside Regulation 883/2004. Nevertheless, Articles 20-21 TFEU prevented refusal merely because he studied in another Member State: paragraphs 69-79.<br>The qualification is important: he retained residence in his Finnish home municipality and returned regularly. This does not establish an unrestricted right to export all personal assistance following permanent relocation.<br>Where your theory encounters a legal limit<br>The principal counterauthority is von Chamier-Glisczinski, C-208/07, particularly paragraphs 84-89.<br>The Court explained that EU law coordinates rather than harmonises social-security systems. Moving abroad need not be financially neutral. In that case, the interaction between German and Austrian care systems left the claimant worse off, but EU citizenship did not oblige Germany to fund equivalent institutional care abroad outside the coordination mechanisms.<br>That distinction produces three possible outcomes:<br>Cause of the gap	Likely legal analysis<br>The original State withdraws an exportable cash benefit solely because the child moves	Potential breach of Article 7 and the relevant benefit-specific rules.<br>The destination State refuses support because it ignores foreign qualifying periods or insists on an excessive territorial connection	Potential breach of Articles 4-6 and/or free-movement law.<br>The original benefit is lawfully non-exportable, while the destination State has no equivalent entitlement under otherwise lawful rules	A real gap can remain; EU law does not generally guarantee equivalent replacement support.<br><br>The parent's status also matters. A worker has particularly strong protection through Article 45 TFEU and Regulation 492/2011. For an economically inactive family, entitlement can be affected by lawful-residence conditions: Dano, C-333/13, confirms that Article 4 of Regulation 883/2004 does not invariably overcome those conditions for special non-contributory benefits.<br>My assessment is that your strongest argument concerns the interaction of specific territorial conditions, rather than a general claim that any reduction in disability support violates free movement. Stewart and Städteregion Aachen give substantial support where authorities disregard the family's actual connections or impose a residence requirement that unnecessarily deters the parent's movement.<br>To determine whether your exact "neither State pays" scenario is lawful, the next step is to identify the two States, the particular benefit or service, and whether the parent moves to work. Without those details, the cases establish the possibility of a gap and strong grounds for challenging certain causes of it—but not that both refusals would survive EU-law scrutiny. | Comparator, not a run of this app. Reviewer: "this is what I would like, and could be a very good start to a reasurch session". | n/a |

### Evaluation context

| Field | Value |
| --- | --- |
| Rating status | A1 awaits rating. B1 is a comparator and is not rated on this scale |
| Actual test dates | Not supplied for A1. Logged 23 September 2026 |
| Model / configuration / application commit | Not supplied. A1 cites 27 sources, which is above the quick-mode `maxSources` default of 14 and consistent with the deep path's 28 (`src/lib/ask/config.ts`), so A1 was almost certainly a deep research run |
| Retrieved source texts and citation URLs | Not supplied; numeric citation markers are preserved as pasted. A1's own text identifies the retrieved set well enough to reason about it: Reg. 883/2004 Arts 3 and 70, Reg. 988/2009, Reg. 987/2009, Directive 2011/24, EEA JCD 76/2011, EFTA Court E-3/23 and E-26/25, and nine CJEU decisions of which it names C-576/20 and C-151/24 |
| Verified reference answer | None supplied. B1 stands in for one, and is itself unverified — see the verification list below |
| Diagnostic status | **Partly verified.** C-257/24 confirmed against external sources; the Einarsdóttir cross-reference is unresolved and is the open item |

### Why this entry is different

Q1 and Q2 were diagnosed by reading the code after the fact. Q3 comes with a
second answer to the same question from a different system, which is a better
instrument than either: it separates *the well cannot reason about this* from
*the well was not handed the material*. The answer, clearly, is the second, and
that is the most useful thing this run establishes.

Stated once, plainly, because everything below is a gloss on it: **A1 is the
better answer on the legislation and the worse answer on the case law, and it is
not close in either direction.** A1 reads Article 70 and finds the limb of it
that decides the question; it has the EEA layer, which B1 lacks entirely. B1 has
five decisions squarely on the reviewer's facts; A1 has none. A merge of the two
is the answer the reviewer asked for, and the half that is missing is a
retrieval and coverage problem, not a reasoning one.

### What A1 got right

Worth recording in as much detail as the defects, because the temptation after
reading B1 is to conclude the whole pipeline underperforms, and that is not what
the evidence shows.

- **It read the legislation, and B1 did not.** A1's account of Article 70 is
  built from the text of the Article: the three cumulative conditions, the
  disapplication in Article 70(3), the residence rule in Article 70(4). B1
  presents Articles 4, 5, 6, 7 and 70 as a five-row summary table with no text
  quoted from any of them. On statute this application is the better instrument,
  and this is the second question running where that has been true.
- **It found the limb of Article 70 that decides the question.** A1 notices that
  Article 70(2)(a)'s second branch — *"solely specific protection for the
  disabled, closely linked to the said person's social environment in the Member
  State concerned"* — means that disability benefits are one of the two
  categories the SNCB regime was drafted for, so the Annex X listing question is
  decisive rather than incidental. That is the sharpest single observation in
  either answer, and B1 does not make it: B1 lists Article 70 as "a significant
  exception" and moves on.
- **It handled C-576/20 *CC* properly, including what it is not authority for.**
  A1 gets the reformulation under Article 21 TFEU, the exhaustiveness question,
  the *Reichel-Albert* line, the holding, and then says explicitly that the
  remedy was conditioned on exclusive connection and that the case is about the
  former State taking a cross-border fact into account rather than a claimant
  falling between two systems. B1 does not have C-576/20 at all. Reading a case
  for its limits is the harder half of the job and A1 did it.
- **The EEA layer is entirely A1's.** JCD 76/2011, Article 29 EEA, E-3/23,
  E-26/25 *Mohr-Egger*, and recital 17a of Regulation 988/2009 with its
  "while respecting Community law" qualifier — which A1 correctly identifies as
  the hook for a de facto restriction argument. B1 has no EFTA Court, no EEA
  Agreement and no Icelandic dimension whatever. For this product that is the
  point of the product, and it is the one axis on which A1 is unambiguously
  ahead.
- **The gap list is nearly the right research plan.** A1's closing list of
  searches names Annex X, Article 7, Article 67 and the family-benefits chapter,
  case law classifying care allowances as sickness benefits in cash rather than
  SNCBs, derived rights of family members, and Article 21/45 TFEU residence and
  connection conditions. Four of those five headings lead to *Stewart*,
  *Hendrix* and *Städteregion Aachen*. A1 knew what it was missing and named it
  accurately. It simply did not go and get it, which is the defect below.

### What B1 had that A1 did not

- **Case law, and the gap is total.** B1 names six decisions on or near the
  facts — C-503/09 *Stewart*, C-257/24 *Städteregion Aachen*, C-287/05
  *Hendrix*, C-679/16 *A (Assistance for a disabled person)*, C-208/07 *von
  Chamier-Glisczinski* and C-333/13 *Dano*. A1 names none of them and says, of
  the nine decisions it did retrieve, that none concerns disability, care
  benefits, or children as beneficiaries at all.
- **C-257/24 is the reviewer's hypothesis as a decided case.** Confirmed
  externally, 23 September 2026: judgment of 10 July 2025, a minor German-Irish
  national resident with her parents in Belgium with a disability requiring
  specific care, mother a German national working in Germany, Städteregion
  Aachen refusing school assistance for 2021/2022 on the ground of ordinary
  residence in Belgium. B1's account that the benefit fell outside Regulation
  883/2004 on an individual-needs-assessment analysis and that the residence
  requirement nonetheless offended Article 7(2) of Regulation 492/2011 matches
  the external summaries; B1's paragraph numbers are not verified. This is the
  case the question was asking for, it is from 2025, and A1 did not surface it.
- **Article 6 aggregation against the host State.** B1's *"Article 70 does not
  disapply Article 6"* is the best doctrinal point in either answer, and it goes
  to the half of the reviewer's hypothesis A1 never analysed. A1 worked through
  losing the benefit at home and stopped; the claim that the child *"does not
  fulfill the requirements to gain benefits in his new state"* is an aggregation
  question against the host State, and A1 had Article 3 and Article 70 in front
  of it and never asked it. This is a reasoning gap, not a retrieval gap, and
  it is the one place where A1 is worse for a reason retrieval would not fix.
- **Counter-authority.** B1 names *von Chamier-Glisczinski* for the proposition
  that coordination is not harmonisation and a move need not be financially
  neutral — the case that most directly defeats the reviewer's theory. An answer
  that does not name what is against you is an advocacy memo. A1 has no
  counter-authority because it had no cases.
- **Shape.** B1 answers the question that was asked. Its three-outcome table is
  keyed to the *cause* of the gap — exportable benefit withdrawn on departure;
  host State ignoring foreign periods or demanding excessive connection; a
  lawfully non-exportable benefit with no host-State equivalent — and only the
  third is a gap EU law tolerates. That taxonomy is the deliverable. A1
  organises by source and answers "what do my sources say", which is a different
  and lesser question. B1 also closes by naming the three facts that would
  settle it (which two States, which benefit, does the parent move to work);
  A1 closes with a list of database searches, which is useful to an engineer and
  not to a lawyer.

### Four defects in A1

**D1 — nine decisions retrieved, zero relevant.** The decisions A1 got are about
A1 certificates and the dialogue and conciliation procedure, child-raising
periods for a pension, currency conversion of child allowance, and an old-age
social allowance for a third-country national. That is the shape of a result set
retrieved on the *instrument* — "Regulation 883/2004" — rather than on the
*facts*. Nothing in the set suggests a search was ever run for a disabled child,
a care allowance, a residence condition or a genuine link, even though A1's own
closing paragraph names all four as what it would need.

**D2 — C-257/24 is the test case for whether this is coverage or retrieval.**
The CJEU adapter sweeps newest case year first from a cursor
(`src/ingestion/adapters/cjeu.ts`), which is the right default and means the
corpus fills in from 2026 backwards. On that design the 2025 judgments are the
*most* likely to be held, not the least — and A1 did cite C-151/24, so the
2024–2025 vintage is clearly present. So either C-257/24 is in the corpus and
retrieval missed it, or it is absent for some other reason. Those are different
bugs with different fixes, and one query separates them. Note also that
newest-first predicts exactly the shape of B1's advantage: *Hendrix* (2007),
*von Chamier-Glisczinski* (2009), *Stewart* (2011), *Dano* (2014) and C-679/16
(2018) all sit in the years the sweep has not yet reached. If the query comes
back "C-257/24 present, the rest absent", both diagnoses are true at once.

**D3 — the unverified marker fired on the wrong sentences.** This is the
defect the reviewer felt without naming, and it is the most serious one here,
because it inverts a guarantee the product makes rather than merely failing to
find something.

| Sentence | Marked unverified? | Carries a citation? |
| --- | --- | --- |
| The EFTA Court principle passage from E-3/23 | yes | yes, `27` |
| C-576/20's Article 44(2) condition | yes | yes, `19` |
| The Article 7 / Annex X limitation | yes | no, correctly |
| Derived rights of family members not in the sources | yes | no, correctly |
| *"The EFTA Court's Einarsdóttir judgment, cited in E-3/23 for the proposition that a person must not be disadvantaged in the State of origin for having moved"* | **no** | yes, `27` |

Two sentences that are cited are marked unverified, and the one sentence a
reader would most want checked — an assertion about what one judgment says about
another — is not. Whatever the validator is keying on, it is not tracking the
claim a citation is being offered for. Worth reading `src/lib/ask/citations.ts`
and the answer validator against these five sentences specifically.

**D4 — `find_citing_cases` existed and was not used.** The research loop has a
tool whose description is precisely this job: *"Decisions whose text cites a case
number — what a court did with an earlier ruling, and whether an EFTA Court
advisory opinion has been applied by an Icelandic court since"*, with `"E-5/21"`
as its worked example (`src/lib/ask/tools.ts`). A1 asserted a citing relationship
between two EFTA Court judgments in prose and never called the one tool that
would have made it a citable fact with a document behind it.

### The Einarsdóttir cross-reference — the reviewer's flag

**Unresolved, and it should be resolved before anything else here.** The
reviewer's instinct deserves the weight it is given; the answer is that the
claim is plausible but was not verifiable from the answer, which is itself the
problem.

Plausible, because:

- E-5/21 *Anna Bryndís Einarsdóttir v the Icelandic Treasury* (29 July 2022) is
  Articles 6 and 21 of Regulation 883/2004, migrant worker, equality of
  treatment, calculation of maternity benefit.
- E-3/23 *A v Arbeids- og velferdsdirektoratet* (18 April 2024) is Article 58 of
  the same Regulation, minimum benefit, invalidity benefits, calculation,
  equality of treatment.
- The proposition attributed to it — a person must not be disadvantaged in the
  State of origin solely for having exercised free movement — is standing EFTA
  Court language in social security coordination cases, and E-5/21 is the
  Court's most recent statement of it before E-3/23.

A court citing its own two-year-old judgment in the same branch of the same
Regulation for its own settled formula is unremarkable. That is why it should
not have felt strange, and the reason it did is that nothing in the answer let
the reviewer check it.

Not verified, because it could not be from a session container: the EFTA Court's
judgment PDFs answer `"You don't have permission to download this file"`, and
there is no `DATABASE_URL` here. **The application can settle it in one call.**
Run `find_citing_cases({ caseNumber: "E-5/21" })` against production:

- E-3/23 comes back → the claim is true, and the defect is only that A1 asserted
  it instead of citing E-3/23's own paragraph, which is D4.
- E-3/23 does not come back → the model invented a citing relationship between
  two real judgments. That is a far more serious class of error than a missing
  case, because it is the class the grounding discipline exists to make
  impossible, and it would mean the failure is inside the answer stage rather
  than in retrieval.

Until that query is run, treat the sentence as **flagged, not refuted**.

### What to verify before treating any of this as settled

Neither answer is a verified legal conclusion, and B1 least of all — it is an
uncited comparator with paragraph numbers that no one has checked.

| Claim | Source | Status |
| --- | --- | --- |
| C-257/24 *Städteregion Aachen*, 10 July 2025, disabled child resident in Belgium, mother working in Germany, residence condition on school assistance | B1 | Facts and date confirmed externally 23 Sept 2026; the Art. 7(2) Reg. 492/2011 holding matches published summaries; paragraph numbers 44–45, 49–50, 52 unverified |
| E-3/23 cites E-5/21 *Einarsdóttir* | A1 | **Unresolved.** See above |
| *Stewart* C-503/09 paragraphs 95–104 / 100–102 | B1 | Unverified |
| *Hendrix* C-287/05 paragraphs 51–58 | B1 | Unverified |
| C-679/16 paragraphs 69–79 | B1 | Unverified |
| *von Chamier-Glisczinski* C-208/07 paragraphs 84–89 | B1 | Unverified |
| A1's account of Arts 3 and 70, recital 17a, JCD 76/2011, Directive 2011/24 | A1 | Cited to retrieved text; consistent with the instruments as A1 quotes them |

### Next steps, in order of value per hour

1. **Run `find_citing_cases("E-5/21")` against production.** One query. It
   decides whether there is a grounding bug or only a citation-hygiene bug, and
   nothing else on this list should be prioritised above knowing which.
2. **Check the corpus for the six decisions B1 named**, by CELEX or case number:
   C-503/09, C-287/05, C-208/07, C-679/16, C-333/13, C-257/24. Three possible
   readings, each with its own fix: all absent → coverage; C-257/24 present and
   the rest absent → coverage *and* retrieval, the prediction in D2; all present
   → retrieval alone, and the plan stage is the thing to fix.
3. **If coverage: seed a priority CELEX list into the CJEU adapter.** Newest-first
   is the right default for a 33,000-judgment archive, but landmark case law is
   not uniformly distributed by date, and the EEA-relevant free movement and
   social security canon is a few dozen judgments from 1998–2018 that the sweep
   will not reach for a long time. A `CJEU_PRIORITY_CELEX` list drained before
   the year sweep is cheap — tens of documents — and is plausibly the single
   change with the largest effect on answers of this kind. The gap ledger the
   adapter already keeps is the natural place to put them.
4. **If retrieval: make the plan stage generate fact queries as well as
   instrument queries.** The A1 result set is what an instrument-shaped query
   returns. A question that supplies facts — disabled child, parent moves,
   residence condition, benefit lost in both States — should produce at least one
   search in those terms, in the corpus's language, alongside the searches on
   "Regulation 883/2004". This is testable without a model call by asserting on
   the planned query terms.
5. **Make Q3 a research-loop fixture.** The known gap recorded in `CLAUDE.md` —
   *"the research loop has no offline evaluation at all"*, because `eval:ask`
   replays a recorded retrieval and so switches deep research off — is what makes
   every question above unmeasurable between runs. Q3 is an unusually good
   candidate: the target set is six named decisions, "did it find C-257/24" is a
   boolean, and it exercises the EU/EEA corpus in English rather than the
   Icelandic path everything else tests.
6. **Answer shape: ask for the taxonomy.** B1's advantage in structure is not
   about retrieval and could be had now. On a question of the form "can X
   happen?", an answer organised by *cause and legal consequence* beats one
   organised by *source*, and naming the counter-authority is part of the job.
   Worth a look at whether the answer-stage prompt asks for a conclusion or asks
   for a report on the sources.
7. **The citator (roadmap §6, not started).** This run is the best argument for
   it yet made. The reviewer's question was a citator question — *does E-3/23
   really cite Einarsdóttir?* — and the fact that a competent reader could not
   check it without leaving the application is the product gap this run exposes
   most clearly. `find_citing_cases` is already the engine; what is missing is
   surfacing it to the reader rather than only to the loop.

### One correction to the roadmap while it is in view

*well-roadmap.md* §3.4 records the retrieval budgets as "not started, with one
exception": `maxCandidates` 30, `maxSources` 10, evidence 1,200, provisions
2,400. `src/lib/ask/config.ts` now defaults to `maxCandidates` 60, `maxSources`
14, evidence 2,400 and provisions 12,000, with the deep path at 28 sources,
3,000 evidence and 16,000 provisions. The budgets were raised; that table is
stale, and A1's 27 sources are evidence of it. Q3's problem is not budget.
