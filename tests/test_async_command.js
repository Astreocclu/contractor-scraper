// tests/test_async_command.js
const assert = require('assert');
const { runCommand } = require('../services/async_command');

describe('runCommand', () => {
  it('executes command and returns stdout', async () => {
    const result = await runCommand('echo', ['hello']);
    assert.strictEqual(result, 'hello');
  });

  it('handles timeout', async () => {
    await assert.rejects(
      async () => await runCommand('sleep', ['5'], { timeout: 100 }),
      /timed out/
    );
  });

  it('parses JSON when option set', async () => {
    const result = await runCommand('echo', ['{"key":"value"}'], { json: true });
    assert.deepStrictEqual(result, { key: 'value' });
  });

  it('rejects on non-zero exit code', async () => {
    await assert.rejects(
      async () => await runCommand('false', []),
      /failed with code 1/
    );
  });
});
