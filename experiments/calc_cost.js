const fs = require("fs");
const path = require("path");

const rawDir = "./experiments/results/raw";
const files = fs.readdirSync(rawDir).filter(f => f.endsWith(".json"));

let totalCost = 0;
let byVariation = {};

for (const f of files) {
  const data = JSON.parse(fs.readFileSync(path.join(rawDir, f)));
  const cost = data.cost_usd || 0;
  totalCost += cost;

  if (!byVariation[data.variation]) byVariation[data.variation] = 0;
  byVariation[data.variation] += cost;
}

console.log("TOTAL EXPERIMENT COST");
console.log("=====================");
console.log("Total: $" + totalCost.toFixed(2));
console.log("");
console.log("By Variation:");
Object.entries(byVariation).sort((a,b) => b[1] - a[1]).forEach(([v, c]) => {
  console.log("  " + v + ": $" + c.toFixed(4));
});
console.log("");
console.log("Runs:", files.length);
console.log("Avg per run: $" + (totalCost / files.length).toFixed(4));
