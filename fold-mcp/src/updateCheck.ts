import { exec } from "child_process";

/** Generic shell runner for the git commands below — no other caller needs this. */
function runCommand(cmd: string, cwd: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = exec(cmd, { cwd });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timed out: ${cmd}`)); }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `exit code ${code}`));
    });
  });
}

/**
 * Checks the repo's own git history for how far behind its upstream it is —
 * backend-agnostic (works the same regardless of which storage backend is
 * active), ported from local-mcp's check_for_updates handler.
 */
export async function checkForUpdates(cliDir: string): Promise<string> {
  try {
    await runCommand("git fetch origin", cliDir);
  } catch (e: any) {
    return `Could not reach remote: ${e.message}\nMake sure you have internet access and git configured.`;
  }

  try {
    const currentDesc = await runCommand("git describe --tags --always HEAD", cliDir).catch(
      () => runCommand("git rev-parse --short HEAD", cliDir)
    );
    const upstream = await runCommand("git rev-parse --abbrev-ref --symbolic-full-name @{u}", cliDir)
      .catch(() => "origin/main");
    const behindStr = await runCommand(`git rev-list HEAD..${upstream} --count`, cliDir);
    const behind = parseInt(behindStr, 10);

    if (behind === 0) {
      return `✅ Already up to date (${currentDesc})`;
    }

    const log = await runCommand(`git log HEAD..${upstream} --oneline --max-count=10`, cliDir);
    let text = `⬆️  ${behind} new commit${behind === 1 ? "" : "s"} available (you're on ${currentDesc}):\n\n`;
    text += log + "\n";
    if (behind > 10) text += `  … and ${behind - 10} more\n`;
    text += `\nTo update:\n  git pull\n  cd fold-mcp && npm run build`;
    return text;
  } catch (e: any) {
    return `Update check failed: ${e.message}`;
  }
}
