import { promises as fs } from "node:fs";
import path from "node:path";
const root = process.cwd();
const config = JSON.parse(await fs.readFile(path.join(root, "config.json"), "utf8"));
const REF_SECONDS = Number(config.medidas.tiempo.referencia);
const REF_AMPS = Number(config.medidas.intensidad.referencia);
const TOL_SECONDS = Number(config.medidas.tiempo.tolerancia);
const TOL_AMPS = Number(config.medidas.intensidad.tolerancia);
if (![REF_SECONDS, REF_AMPS, TOL_SECONDS, TOL_AMPS].every(Number.isFinite) || REF_SECONDS <= 0 || REF_AMPS <= 0 || TOL_SECONDS < 0 || TOL_AMPS < 0) throw new Error("config.json: medidas no válidas");
const recordsDir = path.join(root, "data", "pruebas");
const output = path.join(root, "data", "index.json");
const requiredStatuses = ["pruebaAlarma", "boyaParo", "forzarMarcha", "vaciadoAutomatico", "modoManual"];
const allowedStatuses = new Set(["OK", "Revisar"]);
const entries = await fs.readdir(recordsDir, { withFileTypes: true });
const files = entries.filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}_\d{6}\.json$/.test(entry.name)).map((entry) => entry.name).sort();
for (const file of files) {
  const fullPath = path.join(recordsDir, file);
  const record = JSON.parse(await fs.readFile(fullPath, "utf8"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.fecha || "")) throw new Error(`${file}: fecha no válida`);
  if (typeof record.realizadoPor !== "string" || !record.realizadoPor.trim()) throw new Error(`${file}: realizadoPor no válido`);
  for (const key of requiredStatuses) if (!allowedStatuses.has(record[key])) throw new Error(`${file}: ${key} no válido`);
  if (!(Number(record.tiempoRemanenteReal) > 0)) throw new Error(`${file}: tiempoRemanenteReal no válido`);
  if (!(Number(record.intensidadReal) > 0)) throw new Error(`${file}: intensidadReal no válida`);
  if (!allowedStatuses.has(record.resultadoGlobal)) throw new Error(`${file}: resultadoGlobal no válido`);
  if (typeof record.observaciones !== "string") throw new Error(`${file}: observaciones no válidas`);
}
const data = { files: files.map((file) => `data/pruebas/${file}`) };
await fs.writeFile(output, `${JSON.stringify(data, null, 2)}\n`, "utf8");
