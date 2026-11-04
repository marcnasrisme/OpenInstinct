import { defineHook } from "eve/hooks";
import { logSessionEnded, logTurnSettled } from "@agent/lib/evlog/events";

export default defineHook({
  events: {
    "session.ended": logSessionEnded,
    "turn.settled": logTurnSettled,
  },
});
