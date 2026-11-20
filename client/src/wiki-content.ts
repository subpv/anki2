/**
 * Wiki texts. AI_SPEC is the exact instruction for an AI that writes cards for the JSON import;
 * it is in English on purpose (AIs follow it best), the cards themselves can be in any language.
 */
export const AI_SPEC = String.raw`You create flashcards for "Card", a spaced-repetition app for engineering students.
Output ONE JSON object and nothing else: no explanation, no Markdown code fence.

{
  "course": "Course name (optional)",
  "notes": [ one object per note ]
}

Every note has "type" plus the fields of that type. Optional on every note:
  "tags": "space separated words", "source": "where it comes from, e.g. Lecture 3, slide 12", "sourceUrl": "https://..."

TYPES
1. basic – question and answer (the most common type)
   {"type":"basic","front":"What does an LVDT measure?","back":"Linear displacement.","reverse":false}
   "reverse": true also asks back → front.
2. cloze – hide parts of a text
   {"type":"cloze","text":"Flow is laminar for $Re < {{c1::2300}}$ and turbulent above {{c2::4000::approx.}}.","extra":"shown with the answer"}
   Each number c1, c2 … becomes its own card; the same number is hidden together. "{{c1::answer::hint}}" shows a hint.
3. numeric – the learner types a number with unit
   {"type":"numeric","question":"12 V across 4.7 kΩ. Current?","value":2.553,"unit":"mA","tolerance":2,"explanation":"$I = U/R$"}
   "value" is a JSON number in "unit"; "tolerance" in percent (default 2). Other SI prefixes are accepted when answering.
4. param – calculation with new random numbers on every review
   {"type":"param","question":"A beam of length {{L}} m carries {{F}} kN at midspan. Maximum bending moment?","vars":[{"name":"L","min":2,"max":8,"step":0.5},{"name":"F","min":5,"max":50,"step":5}],"formula":"F * L / 4","unit":"kNm","tolerance":2,"explanation":"$M_{max} = \\frac{F L}{4}$"}
   Put {{name}} in the question. "formula" is math.js syntax: + - * / ^, sqrt(), sin()/cos()/tan() in radians, pi, e, log() = ln, log10(). Only use the variable names.
5. formula – learn an equation; creates cards for recalling it, naming its symbols and each rearrangement
   {"type":"formula","name":"Ohm's law","latex":"U = R \\cdot I","symbols":[{"sym":"U","meaning":"voltage","unit":"V"},{"sym":"R","meaning":"resistance","unit":"\\Omega"}],"rearrangements":[{"solveFor":"I","latex":"I = \\frac{U}{R}"}],"notes":"Valid for ohmic conductors."}
6. code – write code for a task
   {"type":"code","prompt":"Debounce a push button sampled every 1 ms.","language":"c","code":"...","explanation":"..."}
   "language": c, cpp, python, matlab, st (PLC Structured Text), vhdl, verilog, armasm, bash or text.
7. derivation – revealed one step at a time; the first step is the starting point
   {"type":"derivation","title":"Derive the transfer function of a mass–spring–damper.","steps":["$m\\ddot{x} + c\\dot{x} + kx = F$","$(ms^2 + cs + k)X(s) = F(s)$","$G(s) = \\frac{1}{ms^2 + cs + k}$"]}
8. vocab – a word, asked in both directions
   {"type":"vocab","word":"en hund","meaning":"der Hund","picture":"🐕","note":"Pl. hunde"}
   "picture" (optional): one emoji, only when it clearly shows the word (mostly nouns).
9. occlusion – a picture with labels covered; one card per box
   {"type":"occlusion","image":"slide3.png","title":"Name the parts of the gearbox","rects":[{"x":0.08,"y":0.10,"w":0.24,"h":0.16,"label":"Input shaft"},{"x":0.40,"y":0.42,"w":0.24,"h":0.16,"label":"Planet carrier"}]}
   x, y = top-left corner of a box; w, h = its width and height. All four are fractions of the picture's width and height (0 to 1, measured from the top-left). Make each box cover one label completely; "label" is the text under it.

PICTURES
- If the user gave you picture files, use their exact file names: "image": "slide3.png", "picture": "dog.jpg", or ![](slide3.png) inside any text field. The user uploads the same files together with your JSON.
- Otherwise you may link a picture on the public web: a direct https link to the image file (.png, .jpg, .webp), e.g. from upload.wikimedia.org. Card downloads it. Only use links you are sure exist; if unsure, leave the picture out.
- For "vocab", "picture" can also be a single emoji.

TEXT
- All text fields use Markdown. Math is LaTeX: $inline$ and $$display$$.
- Valid JSON: double quotes, no trailing commas, no comments. Line breaks as \n.
- Every backslash must be doubled inside JSON strings: write "\\frac{a}{b}", "\\rho", "\\Omega", "\\cdot".

GOOD CARDS
- One fact, step or idea per card. Short, precise questions; answers that can be checked.
- Calculations → numeric or param. Equations → formula. Proofs and derivations → derivation. Definitions → basic or cloze.
- Write in the language the user asks for; keep units and symbols as in the source.`;

type L = { de: string; en: string };
export interface WikiSection { id: string; title: L; body: L; spec?: boolean }

export const WIKI: WikiSection[] = [
  {
    id: 'ai',
    title: { de: 'Karten mit einer KI erstellen', en: 'Create cards with an AI' },
    body: {
      de: `1. Kopiere die **KI-Anleitung** unten mit dem Knopf *Anleitung kopieren*.
2. Füge sie in ChatGPT, Claude o. Ä. ein. Darunter deinen Stoff (Skript, Folientext, Übungsaufgaben) und z. B.: *„Erstelle 30 Karten auf Deutsch zu diesem Kapitel."*
3. Kopiere die Antwort, öffne **Import → Text einfügen**, füge sie ein, wähle den Kurs und klicke **Import**.

**Mit Bildern:** Gib der KI deine Bilder mit (z. B. Screenshots von Folien). Sie verweist auf die Dateinamen und setzt bei *Bild beschriften* die Kästen selbst. Lade dieselben Bilder beim Import unter **Bilder für diesen Import** hoch. Ohne eigene Bilder darf die KI auch Links zu Bildern im Internet nehmen; Card lädt sie herunter.
4. Hat eine Karte einen Fehler, wird **nichts** importiert und Card listet jede fehlerhafte Karte mit Grund auf. Gib die Liste der KI: *„Korrigiere diese Fehler."*

Vergessene doppelte Backslashes in LaTeX (\`\\frac\` statt \`\\\\frac\`) repariert Card selbst.`,
      en: `1. Copy the **AI instructions** below with *Copy instructions*.
2. Paste them into ChatGPT, Claude or similar, followed by your material (script, slide text, exercises) and e.g.: *"Create 30 cards in English for this chapter."*
3. Copy the answer, open **Import → Paste text**, paste it, pick the course and click **Import**.

**With pictures:** give the AI your pictures too (e.g. screenshots of slides). It refers to them by file name and places the boxes for *Label a picture* itself. Upload the same pictures in the import under **Pictures for this import**. Without your own pictures the AI may also use links to pictures on the web; Card downloads them.
4. If a card has a mistake, **nothing** is imported and Card lists each faulty card with the reason. Give that list back to the AI: *"Fix these errors."*

Card fixes forgotten double backslashes in LaTeX (\`\\frac\` instead of \`\\\\frac\`) by itself.`,
    },
  },
  {
    id: 'spec',
    spec: true,
    title: { de: 'KI-Anleitung (Importformat)', en: 'AI instructions (import format)' },
    body: {
      de: 'Das ist die vollständige Beschreibung des JSON-Formats. Sie ist absichtlich auf Englisch, damit jede KI sie genau befolgt. Die Karten selbst können in jeder Sprache sein.',
      en: 'This is the complete description of the JSON format. Give it to the AI as it is.',
    },
  },
  {
    id: 'types',
    title: { de: 'Kartentypen', en: 'Card types' },
    body: {
      de: `**Für jeden:**

| Kartentyp | Wofür | Karten |
|---|---|---|
| **Frage & Antwort** (\`basic\`) | Frage vorne, Antwort hinten. Passt fast immer. | 1 (oder 2, auch umgekehrt) |
| **Vokabel** (\`vocab\`) | Wort und Übersetzung, in beide Richtungen, gern mit Bild | 2 |
| **Lückentext** (\`cloze\`) | Wörter markieren und auf **Lücke machen** tippen | eine pro Lücke |
| **Bild beschriften** (\`occlusion\`) | Bild hochladen, Beschriftungen mit Kästen verdecken | eine pro Kasten |

**Für Technik und Mathe** (im Editor unter *Mehr Kartentypen*):

| Kartentyp | Wofür | Karten |
|---|---|---|
| **Rechenaufgabe** (\`numeric\`) | Zahl mit Einheit eintippen, wird automatisch geprüft | 1 |
| **Rechenaufgabe mit Zufallszahlen** (\`param\`) | Jedes Mal neue Zahlen | 1 |
| **Formel lernen** (\`formula\`) | Formel, Symbole, Umstellungen | 1 + 1 + je Umstellung |
| **Schritt für Schritt** (\`derivation\`) | Herleitung oder Beweis, Schritt für Schritt aufgedeckt | 1 |
| **Programmieren** (\`code\`) | Code zu einer Aufgabe | 1 |`,
      en: `**For everyone:**

| Card type | For | Cards |
|---|---|---|
| **Question & answer** (\`basic\`) | Question on the front, answer on the back. Fits almost everything. | 1 (or 2, also reversed) |
| **Vocabulary** (\`vocab\`) | Word and translation, both directions, optionally with a picture | 2 |
| **Fill in the gaps** (\`cloze\`) | Select words and tap **Make gap** | one per gap |
| **Label a picture** (\`occlusion\`) | Upload a picture, cover labels with boxes | one per box |

**For science and engineering** (in the editor under *More card types*):

| Card type | For | Cards |
|---|---|---|
| **Calculation** (\`numeric\`) | Type a number with unit, checked automatically | 1 |
| **Calculation with random numbers** (\`param\`) | New numbers every time | 1 |
| **Learn a formula** (\`formula\`) | Formula, symbols, rearrangements | 1 + 1 + one per rearrangement |
| **Step by step** (\`derivation\`) | Derivation or proof, revealed step by step | 1 |
| **Programming** (\`code\`) | Code for a task | 1 |`,
    },
  },
  {
    id: 'writing',
    title: { de: 'Schreiben: Formatierung, Formeln, Lücken', en: 'Writing: formatting, formulas, gaps' },
    body: {
      de: `Alles geht mit den Knöpfen über dem Textfeld: **Fett**, *Kursiv*, Liste, **Formel** (Formel-Editor wie ein Taschenrechner), **Bild** und bei Lückentexten **Lücke machen**. Die Vorschau rechts zeigt, wie die Karte aussieht. Wer lieber tippt, kann das auch:

- **Fett** mit \`**Text**\`, *kursiv* mit \`*Text*\`, Listen mit \`- \`, Code mit Backticks.
- **Mathe** in LaTeX: \`$U = R I$\` im Text, \`$$\\frac{1}{2} m v^2$$\` als eigene Zeile. Ergibt $U = RI$ und $$\\tfrac{1}{2} m v^2$$
- **Lücken:** \`{{c1::Antwort}}\`, mit Hinweis \`{{c1::Antwort::Hinweis}}\`. Gleiche Nummer = gleichzeitig verdeckt. Klappt auch in Formeln: \`$\\tau = {{c1::RC}}$\`.
- **Parameteraufgaben:** \`{{L}}\` im Fragetext wird durch einen Zufallswert ersetzt; die Formel in math.js-Schreibweise, z. B. \`F * L / 4\`, \`sqrt(2*g*h)\`.
- **Zahlen-Antworten:** Einheiten mit SI-Präfix werden umgerechnet (2,5 mA = 0,0025 A), Komma und Punkt gehen beide.
- **Bilder:** im Editor einfügen (einfügen, hineinziehen oder Knopf *Bild*). Im Import nur als Link: \`![](https://…)\`.
- **In JSON** jeden Backslash doppelt schreiben: \`"\\\\frac{a}{b}"\`.`,
      en: `Everything works with the buttons above the text field: **Bold**, *Italic*, list, **Formula** (a formula editor like a calculator), **Picture** and, for gap texts, **Make gap**. The preview shows how the card looks. If you prefer typing, that works too:

- **Bold** with \`**text**\`, *italic* with \`*text*\`, lists with \`- \`, code with backticks.
- **Math** in LaTeX: \`$U = R I$\` inline, \`$$\\frac{1}{2} m v^2$$\` on its own line. Gives $U = RI$ and $$\\tfrac{1}{2} m v^2$$
- **Cloze:** \`{{c1::answer}}\`, with a hint \`{{c1::answer::hint}}\`. Same number = hidden together. Works inside formulas: \`$\\tau = {{c1::RC}}$\`.
- **Parametrised problems:** \`{{L}}\` in the question becomes a random value; the formula uses math.js syntax, e.g. \`F * L / 4\`, \`sqrt(2*g*h)\`.
- **Number answers:** units with SI prefixes are converted (2.5 mA = 0.0025 A); comma and point both work.
- **Images:** add them in the editor (paste, drop or the *Image* button). In imports only as a link: \`![](https://…)\`.
- **In JSON** write every backslash twice: \`"\\\\frac{a}{b}"\`.`,
    },
  },
  {
    id: 'words',
    title: { de: 'Wortlisten', en: 'Word lists' },
    body: {
      de: `Für Vokabeln reicht eine einfache Liste, eine Zeile pro Wort:

\`\`\`
en hund | der Hund | 🐕 | Pl. hunde
at spise | essen | 🍽️ | spiste, spist
god | gut
\`\`\`

Spalten: **Wort | Bedeutung | Bild | Notiz**, getrennt durch Tab, \`|\` oder \`;\`. Bild und Notiz sind optional. Jede Zeile wird zu zwei Karten (beide Richtungen). Mit Bild zeigt die Rückrichtung das Bild und einen **Hinweis**-Knopf. Zeilen mit \`#\` sind Kommentare.`,
      en: `For vocabulary a plain list is enough, one line per word:

\`\`\`
en hund | der Hund | 🐕 | Pl. hunde
at spise | essen | 🍽️ | spiste, spist
god | gut
\`\`\`

Columns: **word | meaning | picture | note**, separated by tab, \`|\` or \`;\`. Picture and note are optional. Each line becomes two cards (both directions). With a picture, the reverse card shows the picture and a **Hint** button. Lines starting with \`#\` are comments.`,
    },
  },
  {
    id: 'anki',
    title: { de: 'Aus Anki übernehmen', en: 'Bring cards from Anki' },
    body: {
      de: 'In Anki: *Datei → Exportieren → Anki-Kartenpaket (.apkg)*. In Card: **Import → Aus Anki importieren**. Notizen werden zu Standard- oder Lückentext-Karten mit Bildern und Schlagwörtern; sie starten als neue Karten (der Anki-Lernverlauf wird nicht übernommen).',
      en: 'In Anki: *File → Export → Anki Deck Package (.apkg)*. In Card: **Import → Import from Anki**. Notes become basic or cloze cards with images and tags; they start as new cards (Anki review history is not carried over).',
    },
  },
  {
    id: 'study',
    title: { de: 'Lernen und Planung', en: 'Studying and scheduling' },
    body: {
      de: `- Card plant mit **FSRS**, dem Algorithmus des aktuellen Anki. Nach der Antwort bewertest du: **Nochmal** (vergessen), **Schwer**, **Gut**, **Einfach**. Unter jedem Knopf steht, wann die Karte wiederkommt.
- **Zielbehaltensrate** (Einstellungen): wie sicher du eine Karte noch weißt, wenn sie wiederkommt. 90 % ist ein guter Wert.
- **Prüfungsdatum** am Kurs: keine Karte wird nach der Prüfung eingeplant, alle kommen in den letzten drei Tagen davor noch einmal.
- Hast du eine Karte einer Notiz heute gelernt, warten ihre Geschwister (z. B. die Rückrichtung einer Vokabel) bis morgen.
- **5-Minuten-Session**: höchstens 15 Karten oder 5 Minuten. **Pauken**: alle Karten eines Kurses, ohne den Plan zu ändern.
- **Zeitbalken**: läuft er ab, wird die Antwort gezeigt und höchstens *Schwer* vorgeschlagen. Zeit in den Einstellungen, 0 = aus.`,
      en: `- Card schedules with **FSRS**, the algorithm of current Anki. After the answer you rate: **Again** (forgot), **Hard**, **Good**, **Easy**. Each button shows when the card comes back.
- **Desired retention** (Settings): how likely you still know a card when it comes back. 90 % is a good value.
- **Exam date** on a course: no card is scheduled after the exam; every card comes up again in the last three days before it.
- Once you studied one card of a note today, its siblings (e.g. the reverse of a word) wait until tomorrow.
- **5-minute session**: at most 15 cards or 5 minutes. **Cram**: all cards of a course without changing the schedule.
- **Timer bar**: when it runs out the answer is shown and at most *Hard* is suggested. Time in Settings, 0 = off.`,
    },
  },
  {
    id: 'keys',
    title: { de: 'Tastenkürzel', en: 'Keyboard shortcuts' },
    body: {
      de: `| Taste | Beim Lernen |
|---|---|
| Leertaste / Enter | Antwort zeigen, dann vorgeschlagene Bewertung |
| 1 2 3 4 | Nochmal, Schwer, Gut, Einfach |
| H | Hinweis (Vokabel mit Bild) |
| Z | Letzte Bewertung rückgängig |
| E | Karte bearbeiten |
| Strg + Enter | Im Editor: Karte speichern |`,
      en: `| Key | While studying |
|---|---|
| Space / Enter | Show answer, then the suggested rating |
| 1 2 3 4 | Again, Hard, Good, Easy |
| H | Hint (word with picture) |
| Z | Undo the last rating |
| E | Edit the card |
| Ctrl + Enter | In the editor: save the card |`,
    },
  },
];
