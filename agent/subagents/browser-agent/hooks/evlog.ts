import { defineHook } from "eve/hooks";
import {
  logSessionEnded,
  logTurnSettled,
  logWorkerResult,
} from "@agent/lib/evlog/events";

// Parent hooks do not run for subagent turns, so the worker logs its own
// timings; its line carries agent.name "browser-agent". A completed
// assignment is logged from its result, and any other ending from the turn.
export default defineHook({
  events: {
    "content.completed": logWorkerResult,
    "session.ended": logSessionEnded,
    "turn.settled"(event, ctx) {
      if (event.data.outcome !== "completed") logTurnSettled(event, ctx);
    },
  },
});
