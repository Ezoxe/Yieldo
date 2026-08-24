# Rapport — vague de correction finale, phase 1.5

Branche `phase-1-5-interface`, sur `47e4d4f`. Quatre points bloquants du dernier
examen de branche, corrigés en une passe, TDD, RED puis GREEN.

Résultat : backend **262** tests (250 + 12), frontend **379** tests (370 + 9),
`npm run build` sans erreur TypeScript. `npm run lint` reste cassé au niveau du
dépôt (eslint absent, pas de configuration) — laissé tel quel.

---

## B1 — le reniflage de signe inversait tout un relevé

### RED

```
backend/.venv/Scripts/pytest.exe tests/test_mapping.py -q
```

Deux tests ajoutés dans `backend/tests/test_mapping.py`. Le premier
(`test_a_debit_column_holding_one_reversal_stays_debit_and_keeps_its_rows_negative`)
passe le fichier par `parse_rows` et affirme sur les centimes résolus, pas
seulement sur le rôle proposé :

```
E       AssertionError: assert [('CARREFOUR ...IRE', 245000)] == [('CARREFOUR ...IRE', 245000)]
E         At index 0 diff: ('CARREFOUR MARKET', 4732) != ('CARREFOUR MARKET', -4732)
tests\test_mapping.py:114: AssertionError

E       AssertionError: assert {0: 'date', 1..., 3: 'amount'} == {0: 'date', 1..., 3: 'credit'}
E         Differing items:  {3: 'amount'} != {3: 'credit'}
tests\test_mapping.py:133: AssertionError
```

Échec attendu : le fichier est un export deux colonnes Débit/Crédit dont la
colonne Débit porte une extourne (`-4,90`). Elle satisfait donc
`_carries_both_signs`, la promotion en `amount` s'applique, et **chaque dépense
devient une recette** — `CARREFOUR MARKET` ressort à `+4732` centimes au lieu de
`-4732`. Le second test couvre le cas miroir (le mélange de signes dans la
colonne Crédit), qui échouait de la même façon.

### GREEN

```
23 passed, 1 warning in 0.05s     (tests/test_mapping.py)
262 passed                        (suite complète)
```

### Modification

`backend/app/importers/mapping.py` — `suggest_mapping` passe en deux temps. La
passe d'en-têtes va jusqu'au bout, puis la promotion `debit`/`credit` → `amount`
n'a lieu que si le mapping terminé ne contient **aucune** colonne homologue :

```python
if "amount" not in taken and ("debit" in taken) != ("credit" in taken):
    for index, role in mapping.items():
        if role in ("debit", "credit") and _carries_both_signs(...):
            mapping[index] = "amount"
            break
```

La colonne « Débit/Crédit » signée unique de l'opérateur n'a pas d'homologue :
tous les tests existants passent inchangés. La fonction reste pure — aucune
session, aucune horloge, aucune E/S — et ne fait toujours que *proposer*.

### Au navigateur

Fichier `releve-debit-credit.csv` (Date ; Libellé ; Référence ; Débit ; Crédit),
colonne Débit non signée sauf une ligne `-4,90`. L'écran de taggage propose
**Débit** et **Crédit** (et non « Montant »). L'aperçu affiche :

| ligne | libellé | montant |
|---|---|---|
| 1 | CARREFOUR MARKET | −47,32 € |
| 2 | PRLV NETFLIX | −13,49 € |
| 3 | EXTOURNE FRAIS TENUE COMPTE | −4,90 € |
| 4 | VIR SALAIRE ACME SAS | +2 450,00 € |

Entrées `+2 450,00 €`, Sorties `−65,71 €`. Les dépenses sont des dépenses.

`shots/final-b1-tagging-1440-light.png`, `shots/final-b1-1440-light.png`.

---

## B2 — `toImport` pouvait surestimer ce que la validation écrit

### RED

```
cd frontend && npx vitest run src/features/import/useImportWizard.test.ts
```

```
× drops keep-list entries the re-analysis no longer reads as duplicates
  → expected [ 2 ] to deeply equal []
× drops them on a dialect change too
  → expected [ 2 ] to deeply equal []
× refuses the commit when the fresh preview has nothing importable left
  → expected true to be false
× forgets the row-keyed choices when the dialect re-indexes the rows
  → expected { '2': 42 } to deeply equal {}
Tests  4 failed | 9 passed (13)
```

Échec attendu : ni `reanalyze` ni `setDialectField` ne filtraient la liste des
doublons conservés. Une entrée nommant une ligne que la nouvelle analyse ne lit
plus comme doublon est comptée deux fois — une fois dans `summary.importable`,
une fois encore comme doublon conservé. Le troisième échec est le plus grave :
`canCommit` reste `true` alors que l'aperçu frais n'a **rien** d'importable. Le
quatrième est le bogue latent de renumérotation.

### GREEN

```
Tests  13 passed (13)
Tests  379 passed (379)   — suite complète
```

### Modification

`frontend/src/features/import/useImportWizard.ts` :

- `keepsStillDuplicated(kept, analyzed)` — la liste réduite à ce que l'aperçu
  frais lit encore comme doublon. Appliquée dans `reanalyze` et dans
  `setDialectField`.
- `REINDEXING_DIALECT_FIELDS` = `{header_row, preamble_rows}`. Ces deux champs
  seuls décalent la numérotation des lignes ; sur eux, `overrides` **et**
  `keepDuplicates` sont remis à zéro. Les autres champs de dialecte (délimiteur,
  encodage, séparateur décimal, format de date, guillemet) changent la *lecture*
  d'une ligne, jamais *quelles* lignes existent — les choix tiennent, et un test
  le verrouille.

`frontend/src/features/import/ImportPage.tsx` : le commentaire de `commitCounts`
décrivait le bogue comme un comportement subi (« a pre-existing wizard
behaviour »). Réécrit : l'invariant est désormais tenu à la source. Le
`Math.max(..., 0)` est conservé — `commitCounts` est exportée et testée
directement, donc rien n'empêche un appelant futur de lui passer un chiffre
absurde — mais il ne couvre plus un chemin atteignable par l'assistant. Le
commentaire du test correspondant, qui affirmait « Reachable today », est
corrigé lui aussi.

### Bogue de renumérotation `row_number` — **fermé**

Fermé dans la même modification, comme autorisé : le correctif tenait en une
condition sur le champ modifié. `row_number` est un index 1-basé dans les lignes
de *données* (`backend/app/importers/parser.py:71`) ; déplacer l'en-tête ou le
préambule renumérote tout, et une correction de catégorie qui survivait
atterrissait sur une autre transaction. Deux tests le couvrent : l'un vérifie
l'oubli sur `preamble_rows`, l'autre vérifie que `decimal_separator` ne détruit
rien.

### Au navigateur

1. Import du fichier, validé — 4 lignes écrites.
2. Ré-import du même fichier : 4 doublons, 0 importable, bouton désactivé avec
   la raison en français.
3. Deux cases « Importer quand même » cochées → la barre affiche
   « **2** lignes à importer, **2** doublons ignorés ».
4. *Retour au tagging* → Libellé passé à « Ignorer », Référence passée à
   « Libellé » → *Voir l'aperçu*. Les libellés changent, les empreintes de
   déduplication aussi : plus aucun doublon.
5. La barre affiche « **4** lignes à importer » — soit exactement
   `summary.importable`. Avant le correctif elle aurait affiché **6**.
6. Validation : « 4 lignes importées ». La barre disait vrai.

`shots/final-b2-1440-light.png`.

---

## B3 — la ligne de fin d'import n'était pas du français

### RED

```
cd frontend && npx vitest run src/features/import/ImportSummary.test.tsx src/design/EmptyState.test.tsx
```

```
× historySentence > agrees in the singular, without naming the same date twice
  → expected 'Vos 1 opération va du 1er mars 2025 a…' to be 'Votre seule opération date du 1er mar…'
× ImportSummary — the completion line > agrees in the plural
  → expected '320 ligne importées dans « releve.csv…' to be '320 lignes importées dans « releve.cs…'
Tests  2 failed | 7 passed (9)
```

Échec attendu : `plural(count, word)` suffixait la *phrase* et non le nom, d'où
« 320 ligne importées », « N doublon ignorés », « N ligne en erreurs ». Le test
sur `historySentence` était, lui, verrouillé sur la chaîne fautive.

Les cas singulier et zéro de `ImportSummary` passaient déjà — par accident : à 0
et à 1 l'ancien helper n'ajoutait pas de « s ». Ils restent dans la suite comme
garde-fous.

### GREEN

```
Tests  9 passed (9)
Tests  379 passed (379)   — suite complète
```

### Modification

Nouveau module `frontend/src/lib/plural.ts`, forme à trois arguments
`plural(count, singulier, pluriel)`, avec la raison écrite dans le module : ce
qui varie n'est pas fiablement la dernière lettre (« elle sera supprimée » /
« elles seront supprimées »), et le français prend le singulier à zéro comme à
un.

Les **quatre** définitions locales sont supprimées et remplacées par l'import
partagé :

- `frontend/src/features/import/ImportSummary.tsx` — la copie fautive ; les
  trois chaînes sont corrigées au passage.
- `frontend/src/features/import/ImportPage.tsx`
- `frontend/src/features/import/ImportHistory.tsx`
- `frontend/src/features/transactions/TransactionsPage.tsx`

Les trois pluriels en ligne passent au helper :

- `TransactionsPage.tsx` — « … reclassée{s} » et « … transaction{s} ».
- `design/EmptyState.tsx` — `historySentence`. « Vos 1 opération va du 1er mars
  2025 au 1er mars 2025. » devient « **Votre seule opération date du 1er mars
  2025.** » Un relevé d'une seule opération tient sur un seul jour
  (`date_from == date_to` par construction), donc nommer les deux bornes
  imprimait deux fois la même date. Le backend renvoie `null` plutôt qu'un
  compte nul (`backend/app/api/history.py`) : il n'y a pas de cas vide à
  formuler. `EmptyState.test.tsx` est corrigé — c'est lui qui verrouillait la
  chaîne fautive.

### Au navigateur

Écran final d'import : « **4 lignes importées** dans « releve-debit-credit.csv »
. » Les autres chaînes consolidées ont été lues sur le même parcours :
« 4 doublons ignorés », « 0 ligne à importer », « Cet import a créé 4
transactions : elles seront supprimées avec le lot. », « Import supprimé : 4
transactions retirées. », et sur le tableau de bord « Vos 197 opérations vont du
24 janvier 2025 au 9 janvier 2026. »

`shots/final-b3-1440-light.png`.

---

## F1 — l'erreur de connexion était du Pydantic anglais brut

### RED

```
backend/.venv/Scripts/pytest.exe tests/test_validation_errors.py -q
```

```
E  assert ['value is no...e an @-sign.'] == ["L'adresse e... pas valide."]
E    At index 0 diff: 'value is not a valid email address: An email address must have
                      an @-sign.' != "L'adresse e-mail n'est pas valide."
E  AssertionError: String should have at least 1 character
E  assert 'Le mot de passe doit contenir au moins 8 caractères.' in
         ['String should have at least 8 characters']
E  At index 0 diff: 'Field required' != 'Le mot de passe est obligatoire.'
E  At index 0 diff: 'Input should be less than or equal to 500' != 'Le champ « limit » …'
E  At index 0 diff: 'Input should be a valid integer, unable to parse string as an
                    integer' != 'Le champ « limit » doit être un nombre entier.'
9 failed, 1 passed, 9 warnings in 0.82s
```

Échec attendu : FastAPI répond aux violations de schéma avec le texte anglais de
Pydantic, sans passer par aucun code du dépôt. Le seul test qui passait déjà
vérifiait que `loc` et `type` sont présents — c'est la forme de réponse à
préserver.

### GREEN

```
10 passed, 9 warnings in 2.02s
262 passed                       — suite complète
app\api\errors.py     41      8    80%
```

### Modification

Corrigé **à la frontière backend**, pas dans le client : `LoginPage.tsx` rend
`ApiError.detail` tel quel par choix de conception, et c'est le bon.

- Nouveau `backend/app/api/errors.py` : `french_message()` traduit une erreur
  Pydantic en une phrase actionnable, `french_validation_detail()` reconstruit
  le corps 422. Un dictionnaire `FIELD_SUBJECTS` donne le sujet français des
  champs qu'un utilisateur saisit (« L'adresse e-mail », « Le mot de passe »,
  « Le fichier »…) ; un champ absent de la table est cité par son identifiant
  (« Le champ « limit » … »), ce qui reste moins élégant mais nomme quand même
  exactement ce qu'il faut corriger. Tous les types que les schémas et les
  paramètres de requête de cette application peuvent produire sont couverts.
- `backend/app/main.py` : gestionnaire `RequestValidationError` enregistré, qui
  remplace celui de FastAPI.

Deux effets de bord voulus, tous deux testés :

- `loc` et `type` sont conservés — un client sait toujours *quel* champ a échoué
  et *pourquoi*, sans lire de prose. Seul `msg` est réécrit.
- `input` est **supprimé** du corps. FastAPI renvoyait la valeur rejetée à
  l'appelant : sur un mot de passe trop court, c'était le mot de passe en clair.

### Autres points de fuite vérifiés

Toutes les `HTTPException` levées par l'application sont déjà en français —
`app/api/{accounts,auth,categories,imports,transactions}.py`,
`app/security/deps.py`, et les 503/403 de `app/main.py`. Aucune autre route ne
fuit d'anglais par le même mécanisme.

Une seule chaîne anglaise subsiste, `app/main.py:55`, `detail="Not Found"` pour
un chemin `/api/*` inexistant. Elle n'est atteignable que si le frontend appelle
une route qui n'existe pas — un bogue, pas une situation utilisateur — et c'est
la formule HTTP conventionnelle. **Laissée en l'état** : hors périmètre, et
signalée ici plutôt que corrigée en élargissant la modification.

### Au navigateur

`/connexion`, `pas-un-email` + un mot de passe, *Se connecter*. L'alerte affiche
« **L'adresse e-mail n'est pas valide.** » Vérifié aussi directement sur l'API :

```
$ curl -s -X POST http://127.0.0.1:8000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"pas-un-email","password":"…"}'
{"detail":[{"loc":["body","email"],"msg":"L'adresse e-mail n'est pas valide.",
            "type":"value_error"}]}
```

`shots/final-f1-1440-light.png`, `shots/final-f1-1440-dark.png`,
`shots/final-f1-390-light.png` — la paire d'alerte tient dans les deux thèmes et
à 390 px.

---

## Fichiers touchés

Backend :

- `app/importers/mapping.py` (B1)
- `app/api/errors.py` — nouveau (F1)
- `app/main.py` (F1)
- `tests/test_mapping.py` (B1)
- `tests/test_validation_errors.py` — nouveau (F1)

Frontend :

- `src/lib/plural.ts` — nouveau (B3)
- `src/features/import/useImportWizard.ts` (B2)
- `src/features/import/ImportPage.tsx` (B2, B3)
- `src/features/import/ImportSummary.tsx` (B3)
- `src/features/import/ImportHistory.tsx` (B3)
- `src/features/transactions/TransactionsPage.tsx` (B3)
- `src/design/EmptyState.tsx` (B3)
- `src/features/import/useImportWizard.test.ts` (B2)
- `src/features/import/ImportPage.test.tsx` (B2)
- `src/features/import/ImportSummary.test.tsx` — nouveau (B3)
- `src/design/EmptyState.test.tsx` (B3)

## Remise en état de l'environnement de vérification

Le backend tournait sans `--reload` et sous le Python système : il ne pouvait pas
voir la modification de `main.py`. Relancé depuis `backend/` avec
`backend/.venv/Scripts/python.exe`, détaché via `Start-Process`. Les deux lots
d'import créés pour la vérification ont été annulés depuis l'écran « Imports
précédents » ; le grand livre de démonstration est revenu à ses 197 opérations,
confirmé sur le tableau de bord. Le thème avait été basculé en « Sombre » pour
une capture, il est remis sur « Clair ».

---

# Rapport — correction de la régression introduite par `9bcfddf`

Branche `phase-1-5-interface`, sur `9bcfddf`. Le ré-examen restreint a validé les
quatre points bloquants (ADRESSÉS) mais a relevé une régression née de la vague
elle-même, plus un défaut d'une ligne de la même famille. Corrigés en une passe,
TDD, RED puis GREEN.

Résultat : backend **262** tests (inchangé), frontend **389** tests (379 + 10),
`npm run build` sans erreur TypeScript. `npm run lint` reste cassé au niveau du
dépôt (eslint absent) — laissé tel quel.

---

## R1 — les corrections de catégorie disparaissaient sans un mot

`setDialectField` remettait `overrides` et `keepDuplicates` à zéro dès que
`header_row` ou `preamble_rows` changeait — ce qui est juste, puisque ces deux
champs déplacent le début des données et renumérotent chaque ligne
(`row_number`, index 1-based sur les lignes de données, voir
`backend/app/importers/parser.py`). Mais rien ne le disait : l'instruction
suivante remplaçait `errors` par `validateMapping(...)`, normalement vide. Et le
champ « Lignes de préambule » est un `<input type="number">` nu dont le
`onChange` part à chaque frappe : un frôlement suffisait à effacer toutes les
catégories corrigées de l'aperçu, sans avertissement ni trace.

Deuxième moitié du défaut : `setDialect(nextDialect)` avait lieu **avant** le
`try`, l'effacement **dedans**. Une analyse en échec (coupure réseau, 401, 413,
500) laissait donc le dialecte renumérotant en place *et* les anciennes clés de
ligne intactes ; le « Voir l'aperçu » suivant appelait `reanalyze`, qui ne les
efface jamais, et les appliquait à la nouvelle numérotation.

### RED

```
cd frontend
npx vitest run src/features/import/useImportWizard.test.ts \
               src/features/import/ImportPage.test.tsx \
               src/features/transactions/TransactionsPage.test.tsx
```

```
 FAIL  ImportPage.test.tsx > names what was lost, in French, on the screen where it happened
 FAIL  ImportPage.test.tsx > lets the user dismiss it
 FAIL  ImportPage.test.tsx > neither repeats nor erases the notice on the next keystroke
 FAIL  ImportPage.test.tsx > carries the discard through to the preview: the corrected category is gone
 FAIL  useImportWizard.test.ts > says what the re-indexing change threw away, counting each kind
 FAIL  useImportWizard.test.ts > stays silent when the re-indexing change had nothing to discard
 FAIL  useImportWizard.test.ts > drops the notice once the user has relaunched the analysis
 FAIL  useImportWizard.test.ts > forgets the row-keyed choices even when the re-analysis fails
 FAIL  TransactionsPage.test.tsx > agrees in number when the rule reclassified a single other transaction
      Tests  9 failed | 58 passed (67)
```

Échecs attendus, et pour les bonnes raisons :

- les quatre tests d'`ImportPage` pilotent l'écran comme un utilisateur (aperçu →
  correction de catégorie + doublon conservé → « Retour au tagging » → frappe
  dans le champ préambule) et attendent un `role="status"`. Il n'en existait
  aucun : `Unable to find role="status"`.
- côté hook, `result.current.discardNotice` valait `undefined` : la propriété
  n'existait pas.
- le test du chemin d'erreur affirmait sur le vrai défaut :
  `expected { '2': 42 } to deeply equal {}` — après une analyse en 500, la
  correction de la ligne 2 survivait au changement de préambule.

Le test « stays silent when the spinner is touched with nothing to discard »
passait déjà (aucune notice n'existait) : c'est un garde-fou, pas une preuve
RED.

### GREEN

```
Test Files  3 passed (3)
     Tests  67 passed (67)
```

puis la suite complète : `37 fichiers, 389 tests`, et `npm run build` →
`built in 7.16s`, zéro erreur TypeScript. Backend inchangé : `262 passed`.

### Ce qui a changé

`frontend/src/features/import/useImportWizard.ts`

- `discardMessage(field, overrides, keepDuplicates)`, fonction pure privée :
  rend la phrase française, ou `null` quand il n'y avait rien à jeter. Les
  décomptes passent par `plural()` (`lib/plural.ts`), et chaque proposition est à
  la voix active — « … a annulé 2 catégories corrigées et 1 doublon conservé » —
  de sorte qu'aucun accord de participe ne dépende du genre ni du nombre de ce
  qui suit. `REINDEXING_FIELD_LABELS` nomme le champ fautif (« Le nombre de
  lignes de préambule a changé », « La ligne d'en-tête a changé ») : l'utilisateur
  lit la cause exacte, pas « un changement ».
- nouvel état `discardNotice: string | null`, exposé par le hook, et action
  `dismissDiscardNotice`. Ce n'est pas une erreur — l'effacement est le
  comportement correct — donc il ne rejoint pas `errors`.
- l'effacement est **remonté avant le `try`**, avec le message calculé sur les
  décomptes lus juste avant. Le chemin d'échec ne peut plus laisser de clés
  périmées face à un dialecte déjà changé.
- la notice n'est posée que si `message` n'est pas `null`. Une seconde frappe
  (« 12 » = deux `onChange`) n'a plus rien à jeter : elle n'annonce rien **et**
  n'efface pas la notice déjà à l'écran.
- elle s'efface d'elle-même à la première analyse réussie (`reanalyze`), à la
  sélection d'un nouveau fichier et au `reset` — jamais de bandeau permanent.

`frontend/src/features/import/DialectPanel.tsx` — la notice s'affiche dans un
`role="status"` (annoncé par les lecteurs d'écran : les choix s'évanouissent sans
autre changement visible) juste sous la grille des champs, donc sous le champ
qui l'a provoquée, avec un bouton « Fermer ».

`frontend/src/features/import/ImportPage.css` — `.yd-dialect__notice` : bordure
`--yd-warning`, fond `color-mix(… 12%)`, texte `--yd-text`. Le `#f4a261` en
couleur de texte ne tiendrait pas AA sur le thème clair ; mesuré dans le
navigateur, le texte donne **12,72:1** en clair et **16,27:1** en sombre.

`frontend/src/features/import/ImportPage.tsx` — `MappingStep` passe
`discardNotice` et `actions.dismissDiscardNotice` au panneau.

## R2 — « les 1 transactions reclassées »

`TransactionsPage.tsx:399-401` codait le pluriel en dur alors que `count === 1`
est atteignable (la notice n'est posée que si `backfilled > 0`). Passé par le
`plural()` partagé, avec l'article et le verbe dans la bascule :

- 1 → « … ; **la transaction reclassée automatiquement ne peut pas être annulée**
  individuellement. »
- n → « … ; **les n transactions reclassées automatiquement ne peuvent pas être
  annulées** individuellement. »

RED : `Expected element to have text content: la transaction reclassée … /
Received: … les 1 transactions reclassées …`.

## Au navigateur

Instance locale (frontend `:5173`, backend `:8000`, propriétaires des ports
vérifiés par `Get-NetTCPConnection` avant de rien croire — les PID du brief
étaient périmés, les deux services répondaient bien en 200), session
`demo@yieldo-demo.fr`, fichier de test généré : 2 lignes de préambule, 6 lignes
de données dont deux identiques (doublon intra-fichier).

1. Aperçu atteint, ligne 1 passée à « Courses », ligne 3 à « Pharmacie »,
   « Importer quand même » coché sur le doublon → la barre annonce **6 lignes à
   importer** (`shots/final2-preview-choices-made-1440-light.png`).
2. « Retour au tagging », champ préambule porté de 2 à 3 → la notice paraît sous
   le champ : « **Le nombre de lignes de préambule a changé : les lignes du
   fichier sont renumérotées, ce qui a annulé 2 catégories corrigées et 1 doublon
   conservé. Reprenez ces choix sur l'aperçu.** »
   (`shots/final2-discard-notice-1440-light.png`,
   `shots/final2-discard-notice-1440-dark.png`). L'arbre d'accessibilité montre
   bien `status atomic live="polite"` portant la phrase.
3. Deuxième frappe (3 → 4), plus rien à jeter : une seule notice, texte
   inchangé — ni doublée, ni effacée.
4. « Fermer » → la notice disparaît (0 `role="status"`).
5. Champ remis à 2 sans aucun choix en place → **rien** ne s'affiche, aucune
   alerte (`shots/final2-noop-silent-1440-light.png`).
6. Cas singulier : une seule catégorie corrigée → « … a annulé **1 catégorie
   corrigée. Reprenez ce choix** sur l'aperçu. »
   (`shots/final2-discard-notice-singular-1440-light.png`).
7. « Voir l'aperçu » après un effacement : toutes les catégories sont revenues à
   « Non catégorisée », la case du doublon est décochée, la barre repasse à
   **5 lignes à importer / 1 doublon ignoré** — et la notice s'est effacée
   d'elle-même.
8. Aucune erreur ni avertissement dans la console.

R2 n'a **pas** été rejoué au navigateur : provoquer une règle apprise qui
reclasse exactement une autre ligne modifierait durablement les catégories du
grand livre de démonstration (le backfill n'est pas annulable — c'est justement
ce que dit la phrase). Le test jsdom affirme sur la phrase rendue, article et
verbe compris.

## Remise en état

Aucun lot d'import n'a été créé : la vérification s'arrête avant « Valider
l'import ». « Imports précédents » ne liste toujours que le lot de l'opérateur
(198 lues / 197 importées / 1 doublon) et l'écran Transactions annonce toujours
« Vos 197 opérations vont du 24 janvier 2025 au 9 janvier 2026 ». Le thème,
basculé en « Sombre » pour une capture, est remis sur « Clair ».

## Réserve reportée

`applyProfile` (même fichier) réécrit le dialecte en bloc à partir d'un profil
enregistré — `header_row` et `preamble_rows` compris — sans toucher aux
`overrides`. Un profil dont le préambule diffère renumérote donc les lignes au
« Voir l'aperçu » suivant, avec les anciennes clés intactes : le défaut d'origine,
sur un autre chemin, atteignable seulement si un profil a été enregistré. Ce
n'est pas une régression de cette vague et le ré-examen ne l'a pas signalé ;
laissé en l'état plutôt que d'élargir la modification, mais il est réel.
