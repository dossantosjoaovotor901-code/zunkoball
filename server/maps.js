'use strict';
/* Carrega game/maps.js (script de navegador) dentro de um vm, sem duplicar os dados dos campos.
   Assim servidor e cliente usam exatamente a mesma definição de mapa. */
const vm = require('vm'), fs = require('fs'), path = require('path');
let cache = null;
function loadMaps() {
  if (cache) return cache;
  const ctx = vm.createContext({});
  cache = vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'game', 'maps.js'), 'utf8') + '\n;({MAPS, MAP_CATALOG})', ctx);
  return cache;
}
module.exports = { loadMaps };
