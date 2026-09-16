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
| Q2 | A2 | Stutta svarið er að tímabundinn ráðningarsamningur rennur að jafnaði sjálfkrafa út við lok þess tímabils sem samið var um, en það er annað álitaefni en uppsögn áður en tímabilinu lýkur.58 Hjá ríkinu má aðeins segja tímabundnum samningi upp fyrir lok samningstíma ef það hefur verið tekið fram í ráðningarsamningnum.9 Á almennum vinnumarkaði sýna heimildirnar að ráðningarsamningur og kjarasamningur ráða miklu um þetta, en þær veita ekki eina almenna reglu sem svarar öllum tilvikum.62021 Tímabundnar ráðningar sæta jafnframt takmörkunum um hámarkslengd, endurnýjun og misnotkun endurtekinna samninga.47
Meginreglan: lok samningstíma og uppsögn fyrir lok hans
Tímabundin ráðning hjá ríkinu fellur sjálfkrafa úr gildi við lok samningstímans.512 Ef ekki hefur verið samið sérstaklega um uppsagnarrétt lýkur ráðningunni því við lok þess tímabils sem tilgreint er í samningnum, án þess að segja þurfi samningnum upp sérstaklega.8 Þetta þýðir þó ekki að ótímabundin eða tímabundin ráðning geti aldrei haldið áfram eftir lokadag. Í Landsrétti 735/2022 var talið að ráðningarsamband hefði haldið áfram eftir að tímabundinn samningur rann út, meðal annars vegna þess að starfsmaðurinn mætti samkvæmt vaktaplani, vinnuframlag hennar var tekið við og vinnuveitandinn gerði henni ekki ljóst að ekki ætti að þiggja frekara vinnuframlag hennar.5 Þá var ekki talið útilokað að nýtt ráðningarsamband stofnaðist þótt skriflegur samningur lægi ekki fyrir.5 Uppsögn fyrir lok samningstíma er því sjálfstætt álitaefni. Hjá ríkinu er lagaskilyrðið skýrt: í ráðningarsamningnum þarf að hafa verið tekið fram að heimilt sé að segja honum upp fyrir lok samningstímans.9
Hámarkslengd, endurnýjun og hlutlægar ástæður
Markmið laga nr. 139/2003 er meðal annars að tryggja að tímabundið ráðnir starfsmenn sæti ekki mismunun miðað við ótímabundið ráðna starfsmenn og að koma í veg fyrir misnotkun þar sem hver tímabundinn samningur tekur við af öðrum án hlutlægra ástæðna.4 Samkvæmt 5. gr. laganna er óheimilt að framlengja eða endurnýja tímabundinn ráðningarsamning þannig að ráðningin vari samfellt lengur en tvö ár, nema annað sé tekið fram í lögum.7 Í sama ákvæði er sérstök regla um stjórnanda sem ráðinn hefur verið til fjögurra ára eða lengri tíma, auk þess sem aðilum vinnumarkaðarins er heimilt að semja um annað fyrirkomulag um framlengingu eða endurnýjun í kjarasamningi.7 Nýr tímabundinn samningur telst taka við af eldri samningi ef hann er framlengdur eða ef nýr tímabundinn samningur kemst á milli sömu aðila innan sex vikna frá lokum eldri samnings.7 Hæstiréttur taldi í máli 218/2017 að nýr tímabundinn samningur sem gerður var daginn eftir að eldri samningur rann út félli innan þess tímamarka.13 Í máli Hæstaréttar 345/2014 hafði starfsmaður verið ráðinn með ellefu tímabundnum samningum á tilteknu tímabili. Dómurinn taldi hvorki að hann hefði öðlast rétt til uppsagnarfrests þegar síðasti samningurinn rann út né að ítrekaðar tímabundnar ráðningar hefðu brotið gegn lögum nr. 139/2003.6 Í dómi Hæstaréttar 218/2017 var jafnframt vísað til þess að hlutlægar ástæður ættu að ráða ákvörðun um tímabundna ráðningu samkvæmt 2. gr. laga nr. 139/2003.13 Í því máli var talið að tímabundnar heimildir Útlendingastofnunar til að ráða tvo starfsmenn væru slíkar hlutlægar ástæður.13 (óstaðfest: engin heimild úr safninu styður þessa setningu)
Almennur vinnumarkaður: má segja samningnum upp?
Heimildirnar sem liggja fyrir innihalda ekki útdrátt úr almennu lagaákvæði sem kveður með almennum hætti á um hvort tímabundnum ráðningarsamningi á almennum vinnumarkaði megi segja upp fyrir lok samningstíma. Þær sýna hins vegar að skýring ráðningarsamningsins, uppsagnarákvæði hans og kjarasamningur geta ráðið úrslitum.202123 Í Félagsdómi F-22/2020 var deilt um hvort Icelandair hefði mátt draga til baka tilkynnta framlengingu tímabundinna ráðningarsamninga án greiðslu launa eða bóta.23 Stefnandi hélt því fram að kjarasamningur gerði ráð fyrir því að uppsagnarákvæði giltu um ótímabundna samninga en ekki samninga þar sem lokadagur væri tiltekinn, og að slíkir tímabundnir samningar væru því óuppsegjanlegir.23 Félagsdómur leysti þó ekki úr þessari efnislegu spurningu; málinu var vísað frá þar sem álitaefnið laut að því hvort ráðningarsamningur hefði yfirhöfuð stofnast og það félli utan verksviðs Félagsdóms, auk þess sem dómurinn taldi sig ekki eiga að leysa úr meintu broti gegn lögum nr. 139/2003.23 (óstaðfest: engin heimild úr safninu styður þessa setningu) Nýlegir dómar um Hval hf. sýna síðan að niðurstaðan getur ráðist af því hvaða réttindi samningur og kjarasamningur veita:

Í Héraðsdómi Vesturlands E-231/2025 var talið að ráðningarsamningur hefði komist á vegna hvalvertíðar. Þótt ráðningin gæti ekki komið að fullu til framkvæmda vegna þess að veiðar hófust ekki á fyrirhuguðum tíma, var vinnuveitandanum gert að greiða laun á uppsagnarfresti. Dómurinn taldi hvorki sjónarmið um force majeure, brostnar forsendur né önnur tilgreind lagaákvæði hagga þeirri skyldu.14
Sama niðurstaða kemur fram í Héraðsdómi Vesturlands E-233/2025, þar sem talið var að ráðningarsamband hefði komist á og vinnuveitandinn bæri skyldu til að greiða laun á uppsagnarfresti þótt forsendur fyrir hvalvertíðinni hefðu breyst.21
Í Héraðsdómi Vesturlands E-320/2025 var Hvalur hins vegar sýknaður á þeim grundvelli að samningurinn veitti starfsmanninum ekki rétt til annars en þess uppsagnarfrests sem honum var tryggður samkvæmt kjarasamningi þegar uppsagnarbréf barst.20 Í Héraðsdómi Vesturlands E-319/2025 var komist að sömu niðurstöðu.22
Þessir dómar benda ekki allir í sömu átt í niðurstöðu sinni, en munurinn virðist meðal annars tengjast efni einstakra samninga, því hvaða kröfur voru gerðar og hvaða uppsagnarfrestur leiddi af kjarasamningi.14202122 Af þeim verður því ekki dregin sú almenna ályktun að allir tímabundnir samningar á almennum vinnumarkaði séu annaðhvort uppsegjanlegir eða óuppsegjanlegir. Í Héraðsdómi Reykjavíkur E-835/2016 og E-830/2016 var deilt um laun í uppsagnarfresti vegna ráðningarsamninga sjómanna sem tilgreindu ákveðið ráðningartímabil.2526 Útdrættirnir sem liggja fyrir sýna ekki forsendur eða dómsorð um það álitaefni og því verður ekki sagt af þeim dómum hvaða efnisreglu dómstóllinn byggði niðurstöðu sína á.2526
Hið opinbera: skilyrði fyrir uppsögn tímabundins samnings
Lög nr. 70/1996 gera ótímabundna ráðningu að meginreglu fyrir ríkisstarfsmenn, með gagnkvæmum þriggja mánaða uppsagnarfresti að loknum reynslutíma nema annað sé samið í kjarasamningi.9 Heimilt er þó að ráða starfsmann tímabundið, og í ráðningarsamningi má taka fram að segja megi samningnum upp af hálfu annars hvors aðila áður en hann fellur sjálfkrafa úr gildi við lok samningstímans.9 Helstu skilyrðin samkvæmt heimildunum eru því þessi:

Tímabundinn samningur þarf að vera heimill og ráðningin má almennt ekki vara samfellt lengur en tvö ár.79
Uppsagnarréttur fyrir lok samningstíma þarf að byggjast á samningnum, en ekki eingöngu á því að ráðningin sé tímabundin.9
Skriflegur ráðningarsamningur skal gerður, en skortur á undirrituðum samningi útilokar ekki sjálfkrafa að ráðningarsamband hafi stofnast.512
Ef samningurinn er framlengdur í verki eða starfsmaður heldur áfram störfum með samþykki vinnuveitanda getur nýtt eða framlengt ráðningarsamband stofnast.5
Við uppsögn þarf eftir atvikum að gæta þeirra verndarreglna sem gilda um opinbera starfsmenn, svo sem reglna um skriflega áminningu.24
Dómar um uppsögn hjá hinu opinbera
### Landsréttur 310/2018 Í Landsrétti 310/2018 var starfsmaður ráðinn tímabundið sem aðstoðarskólameistari til tiltekins lokadags.24 Landsréttur taldi heimilt að ráða hann tímabundið og heimilt að taka fram í samningnum að segja mætti honum upp fyrir lok samningstímans.24 Dómurinn taldi jafnframt að ákvæði um eins mánaðar uppsagnarfrest á þriggja mánaða reynslutíma ætti aðeins við um starfsmenn sem ráðnir væru ótímabundið en ekki um þennan tímabundna samning.24 Samkvæmt dómsúrdrættinum var uppsögnin engu að síður talin ólögmæt vegna þess að ekki hafði verið gætt reglna laga nr. 70/1996 um skriflega áminningu.24 Málið sýnir því að samningsbundinn uppsagnarréttur leysir ekki sjálfkrafa vinnuveitanda undan öðrum lagaskyldum við uppsögn.24 ### Hæstiréttur 218/2017 Í Hæstarétti 218/2017 var starfsmaður fyrst ráðinn tímabundið til tiltekins dags og síðan varð munnlegt samkomulag um nýjan tímabundinn samning.13 Dómurinn taldi að ekki hefði stofnast ótímabundið ráðningarsamband eftir að sá samningur rann út, meðal annars þar sem gögn málsins bentu ekki til þess að til stæði að ráða starfsmanninn ótímabundið og nýr tímabundinn samningur hafði verið lagður fyrir hana.13 Þegar starfsmaðurinn neitaði endanlega að undirrita samninginn taldi dómurinn að svar hennar yrði að skilja sem neitun á starfstilboðinu og uppsögn hennar á því ráðningarsambandi sem aðilar töldu vera í gildi.13 Ríkið var því sýknað af kröfum um bætur vegna ólögmætrar uppsagnar og laun í uppsagnarfresti.13 ### Landsréttur 735/2022 Í Landsrétti 735/2022 var deilt um hvort tímabundin ráðning hefði lokið eða haldið áfram eftir lokadag.5 Starfsmaðurinn hafði mætt samkvæmt vaktaplani eftir lok samningstímans og vinnuveitandinn tekið við vinnuframlagi hennar án athugasemda.5 Landsréttur staðfesti þá niðurstöðu að ráðningarsambandið hefði verið framlengt þótt ekki hefði verið gerður nýr skriflegur samningur.5 Málið snerist ekki um hefðbundna uppsögn fyrir lok samningstíma, en það er mikilvægt um það hvenær vinnuveitandi getur ekki lengur byggt á því að eldri tímabundinn samningur hafi einfaldlega runnið út.5 ### Héraðsdómur Reykjavíkur E-3228/2009 Í Héraðsdómi Reykjavíkur E-3228/2009 hafði framhaldsskólakennari verið ráðinn tímabundið ítrekað.11 Dómurinn taldi að hann hefði átt rétt á ótímabundinni ráðningu þegar honum var boðinn enn einn tímabundinn samningur eftir tveggja ára samfellt starf.11 Sú ákvörðun að bjóða honum aðeins tímabundinn samning var talin ólögmæt og ríkinu gert að greiða honum bætur á þeim grundvelli.11 Dómurinn taldi þó jafnframt að starfsmaðurinn hefði ekki sjálfkrafa haft stöðu fastráðins starfsmanns vegna þess eins að ekki hefði verið gengið frá ótímabundnum samningi.11 Þess vegna var kröfu hans um laun í uppsagnarfresti hafnað.11 Dómurinn greinir þannig á milli réttar til ótímabundinnar ráðningar og þess að ótímabundið ráðningarsamband hafi þegar stofnast með þeim afleiðingum að uppsagnarfrestur sé sjálfkrafa greiddur.11 ### Önnur opinber mál Í úrskurði um Kópavogsbæ, IRR11030398, var miðað við að starfsmaður sem upphaflega hafði verið tímabundið ráðinn hefði síðar verið fastráðinn.16 Uppsögn hans vegna skipulagsbreytinga og hagræðingar var látin standa, enda taldi ráðuneytið að breytingarnar hefðu verið faglega undirbúnar og byggðar á málefnalegum sjónarmiðum.16 Þetta var því ekki dæmi um uppsögn á virkum tímabundnum samningi heldur ágreiningur um hvort tímabundin ráðning hefði síðar breyst í ótímabundna ráðningu.16 Í máli Hafnarfjarðarbæjar, IRR11040243, hafði starfsmaður verið ráðinn tímabundið ár eftir ár í tæp fimm ár og var henni síðan tilkynnt að nýr samningur yrði ekki gerður.10 Kröfu um að ráðuneytið úrskurðaði að henni hefði ólögmætlega verið synjað um fastráðningu eða endurnýjun var hafnað.10 Úrskurðurinn fjallar því einkum um lok eða endurnýjun tímabundinnar ráðningar en ekki um uppsögn fyrir lok tiltekins samningstíma.10 Umboðsmaður Alþingis fjallaði í máli 88/2025 um kvörtun vegna uppsagnar á tímabundnum ráðningarsamningi nema við Háskóla Íslands sem stundaði verklegt nám á Landspítalanum.19 Málinu var þó lokið án efnislegrar niðurstöðu þar sem ákvörðun deildarforseta hafði ekki verið borin undir háskólaráð og endanleg afstaða stjórnvaldsins lá því ekki fyrir.19  Hvað heimildirnar svara ekki  Heimildirnar gefa ekki fulla mynd af öllum reglum almennra kjarasamninga um uppsagnarfrest tímabundinna ráðningarsamninga.202123 Þær sýna heldur ekki útdrátt úr öllum ákvæðum laga nr. 139/2003 eða laga nr. 55/1980, þannig að ekki er unnt að setja hér fram tæmandi reglur um mismunun, skriflegar upplýsingar, sérreglur einstakra atvinnugreina eða réttaráhrif brota.1347 Til að svara tilteknu álitaefni á almennum vinnumarkaði þyrfti því sérstaklega að leita að viðeigandi kjarasamningi, ákvæði ráðningarsamnings um uppsagnarfrest og dómum um þá atvinnugrein sem málið varðar.2021 Fyrir opinberan starfsmann þarf að skoða ráðningarsamninginn, kjarasamninginn og þær sérstöku málsmeðferðarreglur sem kunna að gilda um uppsögnina.924 | We miss some key case law here but this is the best output to date. Moveing into a possitive direction and has clearly outpreformed other tests| |

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
