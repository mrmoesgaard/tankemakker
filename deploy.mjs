// Builds the app and publishes dist/ to the gh-pages branch (served by GitHub Pages).
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const run = (cmd, cwd = ".") => execSync(cmd, { cwd, stdio: "inherit" });
const remote = execSync("git remote get-url origin").toString().trim();
const name = execSync("git config user.name").toString().trim();
const email = execSync("git config user.email").toString().trim();

run("node build.mjs");
writeFileSync("dist/.nojekyll", "");
run("git init -q -b gh-pages", "dist");
run(`git -c user.name="${name}" -c user.email="${email}" add -A`, "dist");
run(`git -c user.name="${name}" -c user.email="${email}" commit -q -m "Udgiv ${new Date().toISOString()}"`, "dist");
run(`git push -q -f ${remote} gh-pages`, "dist");
console.log("Udgivet til GitHub Pages");
