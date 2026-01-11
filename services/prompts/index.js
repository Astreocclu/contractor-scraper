/**
 * Prompt Sets Index
 * Exports both control and qualitative prompt sets for A/B testing.
 */

const control = require('./control');
const qualitative = require('./qualitative');

module.exports = {
  control,
  qualitative,

  // Helper to get prompt set by name
  getPromptSet(name) {
    if (name === 'control' || name === 'a') return control;
    if (name === 'qualitative' || name === 'b') return qualitative;
    throw new Error(`Unknown prompt set: ${name}`);
  }
};
