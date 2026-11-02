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

/**
 * For a non-Admin: every plant readPlants() reports from SAP must be in the user's scope. A plant named by the request
 * proves nothing, so a plant that cannot be read refuses the action (503) rather than letting it through.
 */
async function assertPlantsInScope(user, readPlants, what) {
  const allowedPlants = plantScope(user);
  if (allowedPlants === null) return;
  const refuse = (status, message) => Object.assign(new Error(message), { status, statusCode: status });
  let plants;
  try {
    plants = await readPlants();
  } catch (err) {
    if (err.status >= 400 && err.status < 500) throw err;
    throw refuse(503, `The plant of ${what} could not be read from SAP; nothing was posted (NOT posted). Try again.`);
  }
  if (!plants.length || plants.some((plant) => !String(plant || '').trim())) {
    throw refuse(503, `The plant of ${what} could not be read from SAP; nothing was posted (NOT posted). Try again.`);
  }
  const outside = plants.find((plant) => !isPlantAllowed(plant, allowedPlants));
  if (outside) throw refuse(403, `Plant ${outside} is outside the authenticated user's plant scope`);
}

module.exports = { plantScope, applyPlantScope, isPlantAllowed, assertPlantsInScope };
