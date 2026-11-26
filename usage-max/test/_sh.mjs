// A POSIX sh for tests that really run generated shell. Linux/macOS: the one on PATH. Windows: Git for Windows ships one but it is
// not always on PATH (CI runs these under bash, a plain console on a PC does not), so look in the Git install and put it on PATH.
import fs from "node:fs"; import path from "node:path"; import { spawnSync } from "node:child_process";
const works = (cmd, env) => { const r = spawnSync(cmd, ["-c", "exit 0"], { env, stdio: "ignore" }); return r.status === 0; };
export const shEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  if (works("sh", env)) return env;
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs"), "C:\Program Files"].filter(Boolean);
  for (const r of roots) for (const sub of ["usr\bin", "bin"]) { const d = path.join(r, "Git", sub); if (fs.existsSync(path.join(d, "sh.exe"))) { const key = Object.keys(env).find((k) => k.toLowerCase() === "path") || "PATH"; env[key] = d + path.delimiter + (env[key] || ""); return env; } }
  return env;
};
// A real Python 3 for build-kit.py. PATH first (on Windows `python` may be the Microsoft Store stub, which exits non-zero), then
// UM_TEST_PYTHON for a Python that is installed but not on PATH. null = none: the caller says so loudly and skips that one step.
export const python = () => {
  for (const c of [process.env.UM_TEST_PYTHON, "python3", "python"].filter(Boolean)) { const r = spawnSync(c, ["--version"], { encoding: "utf8" }); if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return c; }
  return null;
};
