const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const www = path.join(root, "www");

fs.mkdirSync(www, { recursive: true });

for (const file of ["index.html", "style.css", "game.js", "config.js", "net.js"]) {
  fs.copyFileSync(path.join(root, file), path.join(www, file));
}

console.log("www synced");
