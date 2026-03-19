export const bkitPlugin = async (ctx) => {
  const { execSync } = require("child_process");
  const fs = require("fs");
  const path = require("path");

  function getHooks() {
    const hooksPath = path.join(__dirname, "hooks", "hooks.json");
    if (!fs.existsSync(hooksPath)) return null;
    try {
      const data = fs.readFileSync(hooksPath, "utf-8");
      return JSON.parse(data).hooks;
    } catch (err) {
      console.error("Failed to parse hooks.json", err);
      return null;
    }
  }

  function executeCommand(commandStr, ctx) {
    if (!commandStr) return;

    const pluginRoot = __dirname;
    const projectDir = ctx.directory || process.cwd();

    // Replace ${CLAUDE_PLUGIN_ROOT} and ${CLAUDE_PROJECT_DIR}
    let cmd = commandStr.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot);
    cmd = cmd.replace(/\$\{CLAUDE_PROJECT_DIR\}/g, projectDir);

    const env = {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      CLAUDE_PROJECT_DIR: projectDir,
      OPENCODE: "1",
    };

    try {
      // Run sync but capture output to avoid spamming the console
      execSync(cmd, { env, stdio: "pipe", cwd: projectDir });
    } catch (error) {
      // Ignore errors to not break OpenCode flow if not strict
      console.error(`Error executing hook command: ${cmd}\n`, error.stderr ? error.stderr.toString() : error.message);
    }
  }

  function runHooks(hooksDef, hookName, matcherValue, ctx) {
    if (!hooksDef || !hooksDef[hookName]) return;

    for (const hookGroup of hooksDef[hookName]) {
      // If there's a matcher, check if it matches the value
      if (hookGroup.matcher && matcherValue) {
        const regex = new RegExp(hookGroup.matcher, "i");
        if (!regex.test(matcherValue)) continue;
      }

      // Run the hooks
      if (hookGroup.hooks && Array.isArray(hookGroup.hooks)) {
        for (const h of hookGroup.hooks) {
          if (h.type === "command" && h.command) {
            executeCommand(h.command, ctx);
          }
        }
      }
    }
  }

  const hooksDef = getHooks();
  if (!hooksDef) {
    console.warn("bkit plugin: hooks.json not found or invalid.");
    return {};
  }

  const sessionStates = new Map();

  return {
    event: async ({ event }) => {
      const sessionId = event.sessionID || event.session_id;

      if (event.type === "session.created" && sessionId) {
        sessionStates.set(sessionId, { started: true });
        runHooks(hooksDef, "SessionStart", null, ctx);
      }

      if (event.type === "session.deleted" && sessionId) {
        sessionStates.delete(sessionId);
      }

      if (event.type === "message.updated") {
        const message = event.properties?.message;
        if (message && message.role === "user") {
          runHooks(hooksDef, "UserPromptSubmit", null, ctx);
        }
      }

      if (event.type === "session.idle") {
        // Equivalent to TeammateIdle or Stop depending on the flow
        runHooks(hooksDef, "TeammateIdle", null, ctx);
        runHooks(hooksDef, "Stop", null, ctx);
      }

      if (event.type === "session.error") {
        runHooks(hooksDef, "StopFailure", null, ctx);
      }
    },

    "tool.execute.before": async (input, output) => {
      const toolName = input.tool;
      runHooks(hooksDef, "PreToolUse", toolName, ctx);
    },

    "tool.execute.after": async (input) => {
      const toolName = input.tool;
      runHooks(hooksDef, "PostToolUse", toolName, ctx);
    },

    "experimental.session.compacting": async (input, output) => {
      runHooks(hooksDef, "PreCompact", "auto", ctx);
      // Wait or perform post compact
      runHooks(hooksDef, "PostCompact", null, ctx);
    }
  };
};
