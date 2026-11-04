import { defineHook } from "eve/hooks";
import { logSessionEnded, logTurnSettled } from "@agent/lib/evlog/events";

// Parent hooks do not run for subagent turns, so the worker logs its own
// timings; its line carries agent.name "browser-agent".
export default defineHook({
  events: {
    "session.ended": logSessionEnded,
    "turn.settled": logTurnSettled,
  },
});
