const fs = require("fs");
const path = require("path");

function safeReadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

module.exports = (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const root = "/var/task";
  const pkgPath = path.join(root, "package.json");
  const pkg = fs.existsSync(pkgPath) ? safeReadJson(pkgPath) : null;

  const nmPath = path.join(root, "node_modules");
  const hasNodeModules = fs.existsSync(nmPath);

  let nodeModulesTop = [];
  if (hasNodeModules) {
    try {
      nodeModulesTop = fs.readdirSync(nmPath).slice(0, 80);
    } catch {}
  }

  res.statusCode = 200;
  res.end(JSON.stringify({
    ok: true,
    varTaskHasPackageJson: fs.existsSync(pkgPath),
    packageJsonName: pkg?.name ?? null,
    packageJsonDeps: pkg?.dependencies ?? null,
    hasNodeModules,
    nodeModulesTop,
    varTaskTopLevel: fs.readdirSync(root).slice(0, 80)
  }));
};
