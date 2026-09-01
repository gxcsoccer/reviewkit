import { spawnSync } from "node:child_process";
for (const dir of ["packages/core", "packages/react"]) {
  const r = spawnSync("npx", ["tsdown"], { cwd: dir, stdio: "inherit", shell: false });
  if (r.status) process.exit(r.status ?? 1);
}
