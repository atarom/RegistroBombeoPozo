import { promises as fs } from "node:fs";
import path from "node:path";
const REF_SECONDS = 47;
const REF_AMPS = 2.9;
const TOL_SECONDS = 8;
const TOL_AMPS = 0.1;
const root = process.cwd();
const recordsDir = path.join(root, "data", "pruebas");
const output = path.join(root, "data", "index.json");
const requiredStatuses = ["pruebaAlarma", "boyaParo", "forzarMarcha", "vaciadoAutomatico", "modoManual"];
const allowedStatuses = new Set(["OK", "Revisar"]);
const calculateResult = (record) => {
  const checksOk = requiredStatuses.every((key) => record[key] === "OK");
  const time = Number(record.tiempoRemanenteReal);
  const amps = Number(record.intensidadReal);
  const timeOk = Math.abs(time - REF_SECONDS) <= TOL_SECONDS;
  const ampsOk = Math.abs(amps - REF_AMPS) <= TOL_AMPS + 0.0001;
  return checksOk && timeOk && ampsOk ? "OK" : "Revisar";
};
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
  const expectedResult = calculateResult(record);
  if (record.resultadoGlobal !== expectedResult) throw new Error(`${file}: resultadoGlobal incoherente; debe ser ${expectedResult}`);
  if (typeof record.observaciones !== "string") throw new Error(`${file}: observaciones no válidas`);
}
const data = { files: files.map((file) => `data/pruebas/${file}`) };
await fs.writeFile(output, `${JSON.stringify(data, null, 2)}\n`, "utf8");
