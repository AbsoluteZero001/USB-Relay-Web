const fs = require("node:fs");
const path = require("node:path");

const frontendRoot = path.resolve(__dirname, "..");
const removableEntries = fs
  .readdirSync(frontendRoot, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      (entry.name === "dist" ||
        entry.name === "dist-electron" ||
        entry.name.startsWith("release")),
  );

for (const entry of removableEntries) {
  const target = path.resolve(frontendRoot, entry.name);
  if (!target.startsWith(`${frontendRoot}${path.sep}`)) {
    throw new Error(`Refusing to remove path outside frontend: ${target}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`removed ${path.relative(frontendRoot, target)}`);
}
