import { defineHook } from "eve/hooks";
import {
  auditApprovalAnswered,
  auditApprovalOpened,
  auditCallSettled,
  auditCallStarted,
} from "@agent/lib/audit/events";

export default defineHook({
  events: {
    "call.started": auditCallStarted,
    "call.settled": auditCallSettled,
    "interaction.opened": auditApprovalOpened,
    "interaction.settled": auditApprovalAnswered,
  },
});
