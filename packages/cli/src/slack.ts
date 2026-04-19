export interface SlackPayload {
  blocks: Array<{
    type: string;
    text?: { type: string; text: string };
  }>;
}

export interface SlackSendOptions {
  /** When false (default), do not actually call MCP — print payload to stdout. */
  send: boolean;
}

/**
 * Slack sender stub. v1 default mode is DRY-RUN: prints the payload JSON to
 * stdout and returns. When `send=true` and `channel` is provided, the actual
 * call would go through the Claude Code MCP tool
 * `mcp__claude_ai_Slack__slack_send_message`. Since this CLI runs outside
 * that harness, the actual invocation is left as a TODO — tests mock this
 * function entirely at the module boundary.
 */
export async function sendSlackMessage(
  channel: string | null,
  payload: SlackPayload,
  opts: SlackSendOptions
): Promise<void> {
  if (channel === null || channel.length === 0) {
    // No channel configured — skip gracefully without error.
    return;
  }
  if (!opts.send) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ channel, ...payload }, null, 2));
    return;
  }
  // TODO: wire actual Slack MCP call here. For v1 real-send is a harness
  // concern; this function stays a thin shim so tests can mock it cleanly.
  // eslint-disable-next-line no-console
  console.log(`pulse: (stub) would send to ${channel}`);
  await Promise.resolve();
}
