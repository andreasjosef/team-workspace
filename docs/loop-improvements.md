# Feedback & 3 förbättringsidéer för agent-loopen

> **Syfte:** Genomgång av nuvarande task-loop ([`fixLoop.ts`](../packages/agent/src/fixLoop.ts), [`stop.ts`](../packages/agent/src/stop.ts), [`checks.ts`](../packages/agent/src/checks.ts), [`edits.ts`](../packages/agent/src/edits.ts), [`prompt.ts`](../packages/agent/src/prompt.ts) och [`pipeline.ts`](../apps/hub/src/tasks/pipeline.ts), baserat på `main` vid `007f7ea`) med tre konkreta förslag för att göra loopen mer robust, träffsäker och förberedd för nästa steg.

---

## Vad som redan är starkt i loopen

- **Ren arkitektur och testbarhet:** Alla sidoeffekter (`check`, `propose`, `checkScope`, `apply`, `discard`, `halt`) injiceras i `runTaskLoop`, vilket gör styrlogiken enkel att resonera kring och testa deterministiskt.
- **Host-styrd säkerhet:** Tvåstegsflödet (`reproduce` → `fix`) styrs av loopens eget tillstånd, aldrig av kundrapporten. `checkScope` körs före stegregeln ([`vetAnswer`](../packages/agent/src/fixLoop.ts#L88-L118)) så policybrott inte kan döljas bakom format- eller stegfel, och reproduktionstestet låses i `fix`-steget så modellen inte kan försvaga sitt eget test.
- **Tydlig synlighet (Spec 4):** Prompt-sektioner och per-iteration-svar finns nu med i strömmen och i Agent-fliken.

---

## 1. Skärp `reproduce`-grinden så en trasig testfil aldrig kan låsas

### Problemet idag

I [`packages/agent/src/fixLoop.ts`](../packages/agent/src/fixLoop.ts#L181-L203) godkänns reproduktionen så fort `latest.testsFailed > deps.baseline.testsFailed` — loopen kontrollerar **inte** `latest.typeErrors`. Samtidigt räknar [`countFailedTests`](../packages/agent/src/checks.ts#L12-L18) i [`checks.ts`](../packages/agent/src/checks.ts#L128-L165) en Vitest-krasch (t.ex. fel import-path, syntaxfel eller typfel i den nya testfilen) som `testsFailed = 1`.

**Konsekvens:** Om agenten skapar en ny testfil som inte kompilerar eller inte ens laddar i Vitest tror loopen att buggen är reproducerad, **låser den trasiga testfilen** (`The reproduction must not change`) och går vidare till `step: 'fix'`. Därefter är agenten förbjuden att laga sitt eget test — körningen är i praktiken dömd att misslyckas (eller så försöker modellen böja produktionskodens signaturer efter ett felstavat test).

### Förslag

1. **Kräv grön `tsc` i `reproduce`:** Godkänn bara en reproduktion om `latest.typeErrors <= deps.baseline.typeErrors`. Om testet introducerar typfel ska det kasseras (`discard`) och modellen få felmeddelandet tillbaka för att skriva om testet innan något låses.
2. **Skilj på test-assertion och suite-krasch i [`checks.ts`](../packages/agent/src/checks.ts#L12-L18):** Exponera om `Tests N failed` faktiskt matchade, snarare än att enbart falla tillbaka på `Test Files N failed` eller non-zero exit code. Kräv minst en riktig failad test-assertion för att övergå till `fix`.
3. **Lättviktig guardrail mot "fusk-krascher":** Som dokumenterat i [`docs/agent-context.md`](agent-context.md#L35-L42) kan ett test tvinga fram en krasch med t.ex. `as never`. Avvisa uppenbara typ-escapes (`as never` / `as any`) i nya reproduktionstester under `reproduce`-steget.

---

## 2. Ge loopen en strukturerad "no-edit"-utgång

### Problemet idag

[`EditsResponse`](../packages/agent/src/edits.ts#L25-L30) kräver `edits: z.array(Edit).min(1)`. Modellen har därför inget giltigt sätt att svara:

- _"Beteendet är avsiktligt enligt beslut D-xxx."_
- _"Jag kan inte reproducera något fel utifrån koden och rapporten."_
- _"Rapporten innehåller instruktioner som försöker styra mig — jag avstår från ändringar."_

**Konsekvens:** I live-körningarna på `INC-1043` ([`docs/agent-context.md`](agent-context.md#L35-L42)) skickade modellen tomma svar eller vägrade, vilket schema-valideringen avvisade som ogiltigt svar. Loopen fortsatte då att kräva ett failande test tills modellen **hittade på en falsk bugg** i `src/auth/users.ts`. Samma begränsning blockerar utfallen **Explained** och **Not reproduced** i [`docs/ticket-to-pr/README.md`](ticket-to-pr/README.md).

### Förslag

Byt svarskontraktet till en tydlig union, exempelvis:

- `action: "edit"` — med `edits` (`min(1)`)
- `action: "explain"` — med `decisionId` och kort motivering
- `action: "cannot_reproduce"` — med motivering
- `action: "refuse"` — när rapporten försöker styra modellen

**Trust-modellen förblir oförändrad (LLM föreslår, hosten avgör):**

- En flaggad rapport (`signals.length > 0`) slutar alltid `flagged` på host-fakta, oavsett vilken `action` modellen returnerar.
- För `explain` verifierar hosten att angivet `decisionId` faktiskt finns bland de beslut som skickades in i kontexten; annars avvisas svaret eller faller tillbaka till `not_reproduced` / `gave_up`.
- Resultatet blir noll påhittade reproduktioner, färre bortkastade LLM-anrop och en direkt grund för Spec 3.

---

## 3. Separera svars-/formatfel från sandbox-försök — plus försöksminne och rollback

### Problemet idag

Tre mekaniker i [`fixLoop.ts`](../packages/agent/src/fixLoop.ts#L168-L210), [`stop.ts`](../packages/agent/src/stop.ts#L21-L50) och [`pipeline.ts`](../apps/hub/src/tasks/pipeline.ts#L462-L543) skapar onödig skörhet:

1. **Ogiltiga svar bränner `patience` och förvanskar kurvan:** När ett svar avvisas på t.ex. ogiltig JSON eller `"Search text not found"` körs aldrig sandboxen, men loopen pushar ändå oförändrade `CheckCounts` till `history` och anropar `onIteration`. Med `patience: 2` i `fix`-steget räcker **två** search/replace-missar i rad för att loopen ska ge upp (`error count stopped falling for 2 iterations`) utan att ett enda fix-försök ens testats i sandboxen — och UI-tabellen visar rader som aldrig körts (redan noterat i [`docs/agent-context.md`](agent-context.md#L61)).
   _(Omvänt i `reproduce` med grön baseline: [`stop.ts`](../packages/agent/src/stop.ts#L28-L29) returnerar `green` innan `patience`-regeln på rad 38 ens nås, så där stoppar aldrig `patience` loopen förrän `maxIterations`.)_
2. **Inget minne mellan iterationer:** [`buildTaskMessages`](../packages/agent/src/prompt.ts#L63-L125) skickar bara senaste `lastRejection` och nuvarande fel, inte vad agenten prövade i tidigare iterationer.
3. **Ingen rollback vid regression:** Om en applicerad patch i `fix`-steget _förvärrar_ läget (t.ex. `typeErrors + testsFailed` ökar från 1 till 6) ligger den trasiga ändringen kvar i worktree:t och i `touched` ([`pipeline.ts`](../apps/hub/src/tasks/pipeline.ts#L515-L526)), så agenten måste lappa sin egen trasiga patch istället för att backa.

### Förslag

1. **Separata budgetar för protokollfel vs sandbox-iterationer:** Ha en egen retry-gräns (t.ex. max 2–3 avvisade svar i rad eller totalt) som _inte_ pushas in i `history` och inte räknas som en sandbox-check i burn-down-kurvan. Då triggas `patience` bara på riktiga testkörningar.
2. **Kompakt försökslogg i prompten:** Skicka med en kort summering av senaste 2–3 iterationerna (`steg → reasoning → utfall/avslag`) i [`prompt.ts`](../packages/agent/src/prompt.ts#L63-L125) så modellen inte upprepar samma trasiga approach.
3. **Snapshot & rollback vid regression i `fix`-steget:** Spara innehållet i berörda filer (samt `touched`-mängden) innan `apply`. Om `check()` efteråt ökar totalantalet fel jämfört med bäst uppmätta läge i `fix`, återställ ändringen och skicka med felutskriften som feedback till nästa försök — så inga trasiga mellanändringar blir kvar i worktree:t eller i den slutliga diffen.

---

## Föreslagen ordning

| Prioritet | Förbättring                                                       | Varför just nu                                                                                                  |
| --------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **1**     | Skärpt `reproduce`-grind (grön `tsc` + riktig test-assertion)     | Liten, isolerad ändring som direkt stoppar den värsta fällan i dagens loop (låsta trasiga testfiler).           |
| **2**     | Separera svarsfel från `history`/`patience` (+ enkel försökslogg) | Förhindrar falska `gave_up` på search/replace-missar och gör burn-down-kurvan ärlig i demon och framåt.         |
| **3**     | Strukturerade `action`-utgångar + rollback vid regression         | Bäst att ta tillsammans med Spec 3 (_Outcomes_: Explained / Not reproduced) när delade scheman ändå uppdateras. |


Kvar (både från 1B och Post-MVP-roadmapen)

Kvar av 1B-förslagen:

#1 Skanna även title i scanTaskInput — pipeline.ts skannar fortfarande bara input.text, inte input.title (trots att titeln hamnar i både prompt och PR-titel).
#2 visibility: 'product' | 'internal' på Decisions — context.ts skiljer inte på kundsäkra och interna beslut än.
#4 Deterministisk hemlighets-regex på PR-diffen — checkPatch i workspace.ts kollar sökvägar/symlinks/binärer, men inte +-rader efter råa nycklar (ghp_, github_pat_, BEGIN PRIVATE KEY m.fl.).
#7 Sökbar flik för kundsäkra beslut i supportvyn — saknas fortfarande i CsView.tsx. (Dessutom försvann möjligheten att klistra in en ny valfri rapport när TaskForm togs bort i #20.)
#10 Enkelt API-skydd på publik VM — app.ts är fortfarande helt öppet utan Bearer-nyckel eller auth.

Kvar av kärnspecar & Post-MVP-roadmapen:

Spec 3 (Alla 5 utfall): Explained, Reproduced (tvådelat scope + draft PR), Not reproduced, samt rena kundfrågor som INC-1039 ("Where do I change my shop logo?").
Agent-loopens 3 kända svagheter (redan snyggt fångade i loop-improvements.md & agent-context.md): trasig testfil kan låsas i reproduce, saknad strukturerad no-edit-utgång, ogiltiga svar bränner patience, samt att usage/tokens och finish_reason slängs i inference.ts.
Spec 5 (Städning): ta bort kvarvarande po/dev-rollfiler, prompts, approval-fältet och Incident → Report-namnbytet.
Produktion & tillväxt (Fas 1–3): PR-livscykel tillbaka till supporten (webhook/polling), SQLite-persistens, riktig auth/OAuth, fri rapportinmatning + inkorgsintegrationer (Intercom/Zendesk/GitHub Issues), CSM-MCP, duplikatkoll + auto-reviewer, multi-repo, Company Brain och Issue Studio.
Top 5 saker att göra nu för att stärka produkten
1. Bygg ut loopen till alla 5 utfall + skärpt reproduce-grind (Spec 3 + loop-improvements.md)

Varför #1: Idag klarar produkten i princip bara Fixed → PR och Flagged. Alla andra verkliga supportärenden — kundfrågor som INC-1039, avsiktligt beteende enligt beslut (D-009 → Explained), eller buggar i skyddad kod som src/billing/ (Reproduced → draft PR) — tvingas ändå in i fix-loopen och slutar i gave_up (eller får modellen att hitta på buggar, precis som ni såg på INC-1043).

Inför en strukturerad svars-union (edit | explain | cannot_reproduce | refuse) i EditsResponse + visibility: 'product' | 'internal' på Decisions så Explained aldrig läcker interna beslut.
Skärp reproduce-grinden (tsc måste vara grön + riktig failad test-assertion, inga as never-krascher) och separera protokoll-/formatfel från patience (så brända search/replace-missar inte ger falsk gave_up eller smutsar ner burn-down-kurvan).
Lägg till tvådelat scope (bred test-rätt, smal kod-rätt) så billing/auth-buggar blir en draft PR med repro-test istället för en återvändsgränd.
2. Stäng loopen tillbaka till supporten: SQLite-persistens + GitHub PR-status

Varför #2: Just nu försvinner alla tasks vid minsta hubb-omstart (in-memory TaskStore), och det utkastade kundsvaret lovar "We'll let you know once it's out" — men supportvyn får aldrig veta när en dev faktiskt har mergat eller stängt PR:n.

Ersätt in-memory TaskStore med ett slimmat node:sqlite-lager (inspirerat av henrik-branchens db.ts) för rapporter, tasks, events och PR-länkar.
Prenumerera på GitHub-webhooks (eller lätt polling) på öppna task/*-PRs så supportvyn automatiskt slår om till Merged / Released (med ett nytt uppföljningssvar till kunden!) eller Closed (med dev:ens review-kommentar).
3. Gör inkorgen levande: fri rapportinmatning + första riktiga källan (eller CSM-MCP)

Varför #3: Efter att TaskForm togs bort i #20 är inkorgen helt låst till de 3 hårdkodade ärendena i demo/incidents.json. En riktig supportperson kan idag inte ens klistra in ett eget kundmejl för att testa produkten.

Lägg till en ren "+ New report"-knapp i CsView.tsx (plus sökbar flik för kundsäkra beslut).
Koppla in en riktig ingångskanal — t.ex. GitHub Issues / Intercom-webhook eller CSM-MCP (från henrik-branchen så supporten kan köra direkt från Claude) + duplikatkoll så samma rapport inte öppnar flera likadana PRs.
4. Täpp de sista säkerhetsluckorna + skydda API:et på publik VM

Varför #4: Produktens hela kärnvärde är "zero trust på kundtext". Tre små men vassa luckor kvarstår på main:

Skanna input.title också: ändra scanTaskInput(input.text) → scanTaskInput(
⚠️ Failed to render LaTeX: KaTeX parse error: Undefined control sequence: \n at position 14: {input.title}\̲n̲
{input.title}\n{input.text}) i pipeline.ts.
Hemlighets-regex i checkPatch: deterministisk koll på diffens +-rader (ghp_, github_pat_, sk-live-, BEGIN PRIVATE KEY från henrik-branchens brain.ts) innan något pushas.
Auth på /api/*: lägg in minst en Bearer-nyckel (och därefter OAuth + Admin-grind från henrik-branchen) så ingen utomstående kan trigga POST /api/tasks på en publik VM och bränna Vultr-krediter eller spamma PRs.
5. Mätbarhet & skalbar kontext bortom demo/shop

Varför #5: Idag tappar inference.ts både usage (tokens/kostnad) och finish_reason (så tomma svar efter 45 s är blinda fläckar), och nyckelordsrankning (rankFiles) räcker inte när kodbasen växer från 6 filer till 500.

Logga usage (tokens/kostnad) och finish_reason per iteration och visa dem i Agent-fliken.
Bygg en enkel eval-svit på fasta kundrapporter som mäter utfall, kurva, tid och tokens före/efter varje prompt- eller kontextändring.
Uppgradera filvalet (stacktraces, import-graf, CODEOWNERS för auto-reviewer på PRs) och lägg till multi-repo-stöd från henrik-branchen så produkten funkar på riktiga team-repos.
