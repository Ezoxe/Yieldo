# La faisabilité d'achat cesse d'être un calculateur immobilier

Design, 2026-09-06. Chantier 3 sur quatre.

## Le problème

L'outil s'ouvrait sur un formulaire dont le premier champ était un prix et le
quatrième un menu appelé « Nature du bien », avec trois valeurs : véhicule,
immobilier, autre. Ce qui en faisait, en pratique, un calculateur immobilier à
qui on pouvait aussi parler d'une voiture. Un foyer épargne aussi pour un
ordinateur, une cuisine, un mariage, une année de formation — et chacun de ces
achats suppose autre chose sur ce qu'il coûte à garder et sur ce qu'il vaut
ensuite.

Deuxième problème : la question que le lecteur vient poser — « combien je dois
mettre de côté par mois, et sur combien de temps » — était calculée mais
enterrée dans un levier, quatre panneaux plus bas.

## Sept natures, et ce que chacune assume

`engines/ownership.NATURE_PROFILES` porte, pour chaque nature, son libellé
français, une phrase disant ce qu'elle prérempli et ce qu'elle laisse
délibérément vide, ses postes de fonctionnement, son taux de décote et sa durée
de possession par défaut.

| Nature | Décote/an | Gardé | Postes préremplis |
|---|---|---|---|
| Véhicule | 15 % | 5 ans | assurance, entretien, carburant |
| Immobilier | 0 % | 5 ans | taxe foncière, charges, assurance, entretien |
| High-tech et équipement | 35 % | 3 ans | aucun |
| Mobilier et électroménager | 15 % | 10 ans | aucun |
| Voyage, loisirs, événement | 100 % | 1 an | aucun |
| Formation et études | 100 % | 1 an | aucun |
| Autre | 0 % | 5 ans | aucun |

**Aucune des quatre natures ajoutées ne prérempli de coût d'usage**, et c'est
le même refus que « Autre » a toujours fait : l'électricité que tire un
ordinateur, l'assurance d'un canapé, l'argent de poche d'un voyage ne sont pas
des chiffres qu'on peut moyenner honnêtement. Ce qu'elles portent en revanche,
c'est une décote et une durée — des propriétés réelles et documentées de la
chose elle-même.

Une décote de 100 % n'est pas une exagération : un voyage n'a pas de valeur de
revente, le prix est intégralement consommé, et la décote dégressive rend
exactement zéro après la première année.

`NATURES` est lu depuis ce catalogue plutôt que réénoncé : une nature ajoutée au
moteur et oubliée ailleurs serait refusée par `assess_feasibility` sur un écran
qui venait de la proposer.

## Le choix vient avant l'outil

`NaturePicker` occupe toute la largeur tant que rien n'est choisi : sept cartes
portant chacune son libellé et sa phrase. Un menu déroulant ne peut montrer
qu'une phrase à la fois, et seulement après que le choix a été fait.

Une fois la nature choisie, elle reste visible — « Vous achetez : High-tech et
équipement · Changer » — et le formulaire est **remonté** à chaque changement :
le carburant d'une voiture survivant sur un appartement serait un reliquat
déguisé en moyenne française.

## Les deux chiffres, en tête

`FeasibilityReport` publie désormais :

* `required_monthly_cents` — ce qu'il faut mettre de côté chaque mois pour
  atteindre le prix à l'échéance. **Jamais nul** : il dépend du prix, de
  l'apport, du taux et de l'échéance, et la capacité mesurée n'a son mot à dire
  sur aucun des quatre. Un foyer dont l'historique est trop court pour un
  verdict reçoit donc quand même ce chiffre-là — le seul sur lequel il peut
  agir.
* `months_at_measured_capacity` — en combien de temps la somme est atteinte au
  rythme réellement mesuré. `null` quand la capacité n'a pas pu être mesurée,
  quand elle est négative (une cagnotte qui rétrécit n'arrive jamais) ou
  au-delà de cinquante ans. Jamais un entier sentinelle déguisé en date.

`SavingPlan` les affiche en tête du verdict, avec la comparaison qui transforme
une cible en plan : combien de plus que ce que les relevés voient le foyer
mettre de côté chaque mois.

## Tests

* Moteur : les deux chiffres, dont celui qui survit à un historique trop court
  et celui qui refuse de nommer une date sur une capacité négative ; et le fait
  que toute nature du catalogue est acceptée par le moteur.
* API : le catalogue complet est publié, chaque profil porte son libellé, sa
  phrase et sa durée, et une nature inconnue est refusée en français plutôt que
  chiffrée à zéro.
* Front : le sélecteur propose ce que le serveur publie et rien d'autre, saute
  une nature sans profil plutôt que de dessiner une carte vide, et le plan dit
  « jamais atteinte » là où le moteur rend `null`.
