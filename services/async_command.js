// services/async_command.js
const { spawn } = require('child_process');

/**
 * Run a command asynchronously (non-blocking alternative to execSync)
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @param {Object} options - Options (timeout, json, cwd, env)
 * @returns {Promise<string|Object>} stdout or parsed JSON
 */
function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const { timeout = 0, json = false, cwd, env } = options;

    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    if (child.stdout) {
      child.stdout.on('data', (data) => { stdout += data.toString(); });
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => { stderr += data.toString(); });
    }

    let timeoutId;
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        const err = new Error(`Command timed out after ${timeout}ms: ${command} ${args.join(' ')}`);
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }, timeout);
    }

    child.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });

    child.on('close', (code) => {
      if (killed) return; // Already handled by timeout
      if (timeoutId) clearTimeout(timeoutId);

      const result = stdout.trim();

      if (code === 0) {
        if (json) {
          try {
            resolve(JSON.parse(result));
          } catch (e) {
            // Try stderr as fallback (some scrapers output there)
            if (!result && stderr) {
              try {
                resolve(JSON.parse(stderr.trim()));
                return;
              } catch (e2) { /* ignore */ }
            }
            const parseErr = new Error(`Failed to parse JSON: ${e.message}`);
            parseErr.stdout = stdout;
            parseErr.stderr = stderr;
            reject(parseErr);
          }
        } else {
          resolve(result);
        }
      } else {
        const err = new Error(`Command failed with code ${code}: ${command} ${args.join(' ')}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

module.exports = { runCommand };
