import { defineHook } from "eve/hooks";
import {
  auditApprovalAnswered,
  auditApprovalOpened,
  auditCallSettled,
  auditCallStarted,
} from "@agent/lib/audit/events";

// Parent hooks do not run for subagent turns, so the worker records its own.
export default defineHook({
  events: {
    "call.started": auditCallStarted,
    "call.settled": auditCallSettled,
    "interaction.opened": auditApprovalOpened,
    "interaction.settled": auditApprovalAnswered,
  },
});
