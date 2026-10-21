'use strict';

const plantScope = require('../handling-unit/plantScope');

function plantClause(allowedPlants) {
  if (allowedPlants.length === 0) return [{ val: 1 }, '=', { val: 0 }];
  return [
    { ref: ['Plant'] },
    'in',
    { list: allowedPlants.map((plant) => ({ val: plant })) }
  ];
}

/** Add the authenticated user's plant scope to an OData SELECT CQN. */
function applyPlantScope(query, allowedPlants) {
  if (allowedPlants === null) return query;
  const select = query?.SELECT;
  if (!select) throw new TypeError('ReservationEntries READ requires a SELECT query');
  const clause = plantClause(allowedPlants);
  select.where = select.where?.length
    ? [{ xpr: select.where }, 'and', { xpr: clause }]
    : clause;
  return query;
}

function isPlantAllowed(plant, allowedPlants) {
  if (allowedPlants === null) return true;
  const normalized = String(plant || '').trim().toUpperCase();
  return Boolean(normalized) && allowedPlants.includes(normalized);
}

module.exports = { plantScope, applyPlantScope, isPlantAllowed };
