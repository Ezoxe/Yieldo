# Déclarer une récurrence, la poser sur un calendrier, la pointer

Design, 2026-09-06. Chantier 2 sur quatre.

## Le problème

`engines/recurrence.py` lit des rythmes dans le passé. Il lui faut trois
occurrences avant de parler, et il refuse toute charge dont le montant se
promène — c'est-à-dire toutes les factures d'eau et d'électricité qui existent.
Les deux refus sont justes pour un détecteur. Les deux laissent le foyer
incapable de dire « je paie ça, ce jour-là, tous les mois » d'une facture qu'il
connaît parfaitement.

Il n'existait donc aucun endroit pour déclarer un abonnement, aucun calendrier
pour voir tomber les échéances, et aucun moyen de pointer une facture payée.

## Trois objets

* une **déclaration** est un fait que le foyer énonce ;
* une **occurrence** est une date à laquelle elle tombe ;
* un **pointage** est le foyer qui coche une occurrence, avec le montant
  réellement facturé.

Rien n'est détecté et rien n'est deviné. Une date d'échéance est de
l'arithmétique sur la première échéance déclarée, jamais une inférence.

## Le montant d'une charge variable

Déclarée comme estimation, facturée autrement. Dès que **trois** échéances ont
été pointées, la médiane des montants réels remplace l'estimation — la médiane
et non la moyenne, parce qu'une facture de régularisation après relevé de
compteur est exactement la valeur qui ne doit pas déplacer le chiffre du mois.

`amount_basis` voyage à côté du montant et vaut `declared` ou `observed`. Une
estimation et une mesure sont deux affirmations différentes, et l'écran dit
laquelle il affiche. Une charge **fixe** garde son montant déclaré quel que soit
le nombre de pointages : un mois au prorata ne doit pas redéfinir en silence ce
que coûte un abonnement.

## Les totaux

Charges et revenus sont comptés **à part**, jamais nettés : un salaire déclaré
cacherait sinon un loyer déclaré dans un total confortable. Une déclaration
inactive, ou dont la date de fin est passée, ne compte dans aucun coût annuel —
facturer quelqu'un pour un abonnement résilié est exactement ce que cet écran
doit empêcher. Ses échéances passées restent au calendrier : elles sont bien
tombées.

## Les dates

Chaque occurrence vaut `première échéance + k périodes`, calculée depuis la
première échéance et **jamais** depuis l'occurrence précédente. Sinon le
rabotage de février deviendrait permanent : un loyer au 31 tomberait au 28 en
février, puis au 28 en mars, et remonterait le calendrier à reculons un mois
court à la fois.

Un jour qui n'existe pas est ramené au dernier jour du mois, jamais sauté : le
loyer du dernier jour est dû le dernier jour qu'il y a.

## Le pointage

`POST /recurrences/declared/{id}/checkins` est idempotent sur
`(déclaration, échéance)` : pointer deux fois la même échéance est le même
geste, donc le second appel corrige le premier. Une seconde ligne doublerait le
mois dans tous les totaux, et la contrainte d'unicité en base l'interdit de
toute façon.

Une échéance à laquelle la déclaration ne tombe pas est refusée : l'accepter
mettrait dans les totaux une occurrence qu'aucun calendrier ne pourrait montrer.

## Les écrans

`/recurrences` porte désormais deux moitiés, dans cet ordre :

1. **Vos récurrences déclarées** — le total annuel des engagements, un
   calendrier mensuel où chaque échéance se pointe d'un clic, et la liste des
   déclarations avec, pour chaque charge variable, la phrase qui dit si son
   montant est mesuré ou encore estimé.
2. **Ce que Yieldo a repéré tout seul** — la détection, inchangée.

La moitié déclarée passe en premier, délibérément : c'est celle que le foyer
contrôle. Ce qu'il énonce est vrai ; ce que le moteur trouve est une
affirmation que Yieldo fait sur le passé et sur laquelle il peut se tromper.

## Tests

* Moteur : 25 tests sur les dates (rabotage de février, année bissextile, pas
  de dérive), l'état d'une occurrence, la bascule estimation/mesure, et les
  totaux séparés.
* API : 22 tests, dont l'isolation entre foyers, le refus d'une échéance
  inexistante, l'idempotence du pointage et la suppression en cascade.
* Front : la grille du calendrier commence bien le lundi, chaque échéance porte
  sa phrase complète dans son nom accessible, et le formulaire envoie le signe
  depuis une question — « une dépense » ou « un revenu » — jamais depuis un
  moins que le lecteur doit penser à taper.
