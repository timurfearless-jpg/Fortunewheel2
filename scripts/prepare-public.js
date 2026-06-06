const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const staticDir = path.join(root, "static");

function assertInside(parent, target) {
  const relative = path.relative(parent, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside ${parent}: ${target}`);
  }
}

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

if (!fs.existsSync(publicDir)) {
  console.log("No public directory to mirror.");
  process.exit(0);
}

assertInside(root, staticDir);
if (fs.existsSync(staticDir)) {
  fs.rmSync(staticDir, { recursive: true, force: true });
}
fs.mkdirSync(staticDir, { recursive: true });

for (const entry of fs.readdirSync(publicDir, { withFileTypes: true })) {
  const sourcePath = path.join(publicDir, entry.name);
  const targetPath = path.join(staticDir, entry.name);
  assertInside(staticDir, targetPath);
  if (entry.isDirectory()) {
    copyDirectory(sourcePath, targetPath);
  } else if (entry.isFile()) {
    fs.copyFileSync(sourcePath, targetPath);
  }
}

console.log("Mirrored public assets into static.");
