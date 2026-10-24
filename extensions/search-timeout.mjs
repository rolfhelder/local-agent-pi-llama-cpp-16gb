// Efficiency guard, not a shell security boundary. Pi's native shell timeout
// owns cancellation and process-tree cleanup; do not abandon a Promise.race.
export const DEFAULT_SECONDS = 30;
export function isShellSearch(command) {
  return /(?:^|[\s;|&({])(?:Get-ChildItem|gci|Get-Item|Get-Content|Select-String|rg|grep|find|findstr|ls|dir|tree)(?=$|[\s;(])/i.test(command);
}
export function applySearchTimeout(event, seconds) {
  if (!['powershell', 'bash'].includes(event.toolName) || !isShellSearch(String(event.input?.command ?? ''))) return false;
  const requested = event.input.timeout;
  event.input.timeout = Number.isFinite(requested) && requested > 0 ? Math.min(requested, seconds) : seconds;
  return true;
}
export default function searchTimeout(pi) {
  let seconds = DEFAULT_SECONDS;
  pi.on('session_start', () => { seconds = DEFAULT_SECONDS; });
  pi.registerCommand('search-timeout', {
    description: 'Show or change shell search timeout in seconds (30 default, maximum 600; reset restores default)',
    handler: async (args, ctx) => {
      const value = args.trim();
      if (value) {
        const next = value === 'reset' ? DEFAULT_SECONDS : Number(value);
        if (!Number.isInteger(next) || next < 1 || next > 600) {
          ctx.ui.notify('Use /search-timeout 1…600 or /search-timeout reset.', 'warning');
          return;
        }
        seconds = next;
      }
      ctx.ui.notify(`Shell search timeout: ${seconds} seconds (current session). Model-requested longer timeouts are capped.`, 'info');
    },
  });
  pi.on('tool_call', event => { applySearchTimeout(event, seconds); });
  pi.on('before_agent_start', event => ({
    systemPrompt: event.systemPrompt + `\nShell commands containing file search/read utilities have a ${seconds}-second timeout cap. Use targeted paths and rg; exclude dependency stores and sessions before traversing. After a timeout narrow the search instead of repeating it. Only the user can raise the cap with /search-timeout SECONDS (up to 600), then restore it with /search-timeout reset.`,
  }));
}
