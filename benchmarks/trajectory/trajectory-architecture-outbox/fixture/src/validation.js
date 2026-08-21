/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const { ValidationError } = require("./errors");

function validatePreferences(preferences) {
  if (!preferences || typeof preferences !== "object") {
    throw new ValidationError("preferences must be an object");
  }
  const allowed = new Set(["email", "sms", "push"]);
  for (const key of Object.keys(preferences)) {
    if (!allowed.has(key) || typeof preferences[key] !== "boolean") {
      throw new ValidationError(`invalid preference ${key}`);
    }
  }
  return { ...preferences };
}

module.exports = { validatePreferences };
