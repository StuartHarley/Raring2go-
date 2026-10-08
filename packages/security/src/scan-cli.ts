import { resolve } from "node:path";
import { scanRepository } from "./repo-scan";

const root = resolve(process.argv[2] ?? process.cwd());
const { scanned, findings } = scanRepository(root);

if (findings.length) {
  console.error(`Possible secrets found in ${findings.length} place(s):`);
  for (const finding of findings) console.error(`  ${finding.file}:${finding.line}  ${finding.description} (${finding.patternId})`);
  process.exit(1);
}

console.log(`Secret scan clean: ${scanned} tracked files checked.`);
