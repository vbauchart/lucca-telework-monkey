# lucca-telework-monkey

Userscript Tampermonkey pour saisir automatiquement les jours de télétravail dans Lucca (module Absences).

## Installation

1. Installer [Tampermonkey](https://www.tampermonkey.net/)
2. Créer un nouveau script et coller le contenu de `lucca-teletravail-final.user.js`
3. Adapter le `@match` en haut du script avec le sous-domaine de ton entreprise (ex. `https://monentreprise.ilucca.net/*`)
4. Ouvrir Lucca — un bouton **🏠 Remplir télétravail** apparaît en bas à droite

## Configuration

Toutes les options sont dans le bloc `CONFIG` en haut du script.

| Paramètre | Description | Exemple |
|---|---|---|
| `teleworkDays` | Jours à déclarer — `0`=Lun, `1`=Mar, `2`=Mer, `3`=Jeu, `4`=Ven | `[1, 4]` → Mar + Ven |
| `weeksAhead` | Semaines à remplir en avant | `4` |
| `weeksBefore` | Semaines à rattraper en arrière | `4` |
| `leaveAccountId` | ID de la catégorie "Télétravail" (**spécifique à ton entreprise**) | `29` |
| `leaveAccountName` | Nom exact de la catégorie (utilisé pour le dédoublonnage) | `'Télétravail'` |

Pour trouver ton `leaveAccountId` : ouvre les DevTools (F12), pose une absence manuellement, et repère `leaveAccountId` dans le payload de la requête `POST leaveRequestFactory/create`.
