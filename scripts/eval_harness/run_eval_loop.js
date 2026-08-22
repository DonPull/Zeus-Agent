#!/usr/bin/env node

/**
 * Single-Trigger Benchmark & Autonomous Evaluation Harness for Zeus Agent
 * 
 * Usage:
 *   node scripts/eval_harness/run_eval_loop.js --target-repo "D:/Hristian projects/Zeus-Agent-Target"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CLI arguments
const args = process.argv.slice(2);
let targetRepo = '';
let promptsFile = path.resolve(__dirname, 'prompts/10_agentic_prompts.json');

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--target-repo' && args[i + 1]) {
    targetRepo = path.resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--prompts' && args[i + 1]) {
    promptsFile = path.resolve(args[i + 1]);
    i++;
  }
}

if (!targetRepo) {
  // Default target repo path fallback if not passed
  targetRepo = path.resolve('D:/Hristian projects/Zeus-Agent-Target');
}

console.log('================================================================');
console.log('⚡ Zeus Agent Autonomous Benchmark & Self-Refinement Harness ⚡');
console.log('================================================================\n');

console.log(`[Config] Target Repository : ${targetRepo}`);
console.log(`[Config] Benchmark Prompts : ${promptsFile}`);

if (!fs.existsSync(promptsFile)) {
  console.error(`[Error] Prompts file not found at: ${promptsFile}`);
  process.exit(1);
}

const prompts = JSON.parse(fs.readFileSync(promptsFile, 'utf8'));
console.log(`[Loaded] ${prompts.length} benchmark prompts ready for evaluation.\n`);

// Initialize EVAL_STATUS.md in the current working directory if missing
const statusPath = path.resolve(process.cwd(), 'EVAL_STATUS.md');
if (!fs.existsSync(statusPath)) {
  const initialStatus = `# Zeus Self-Refinement Benchmark Status

- **Overall Progress**: Ready to start (0 / ${prompts.length} completed)
- **Target Repository**: \`${targetRepo}\`
- **Current Phase**: \`Initialization\`
- **Active Task**: None

## Prompt-by-Prompt History

${prompts.map((p, idx) => `### Prompt ${idx + 1}: ${p.title} (\`${p.name}\`)\n- **Status**: ⏳ PENDING\n- **Trials Run**: 0\n- **Latest Score**: N/A\n- **Key Issues**: None\n- **Patches Applied**: None\n`).join('\n')}
`;
  fs.writeFileSync(statusPath, initialStatus, 'utf8');
  console.log(`[Created] Initial status tracking file at: ${statusPath}`);
}

// Load evaluator instructions prompt template
const evaluatorPromptPath = path.resolve(__dirname, 'eval_evaluator_prompt.txt');
let evaluatorPrompt = '';
if (fs.existsSync(evaluatorPromptPath)) {
  evaluatorPrompt = fs.readFileSync(evaluatorPromptPath, 'utf8');
  evaluatorPrompt = evaluatorPrompt.replace(/<TARGET_REPO>/g, targetRepo.replace(/\\/g, '/'));
}

console.log('\n--- 🚀 How to Start the Experiment in Zeus Agent UI ---');
console.log('1. Ensure your local Qwen model server (ik_llama.cpp) is running at http://localhost:11434/v1');
console.log('2. Open the main Zeus Agent desktop app (`npm run tauri dev`).');
console.log('3. Create a new task titled "Autonomous Benchmark & Self-Refine" and send this message:\n');
console.log('----------------------------------------------------------------');
console.log(`Please execute the autonomous benchmark and self-refinement mission against the target repository located at:
"${targetRepo}"

Follow the evaluator guidelines and benchmark prompts in:
"${promptsFile}"

Maintain live progress in "EVAL_STATUS.md" after every trial. Run all 10 prompts through test creation, execution, artifact inspection, and code self-refinement until each prompt scores >= 8.5/10. Compile the final summary in "FINAL_EVAL_REPORT.md".`);
console.log('----------------------------------------------------------------\n');
console.log('⚡ Ready! Environment variables for unlimited iterations and budget bypass are enabled.');
