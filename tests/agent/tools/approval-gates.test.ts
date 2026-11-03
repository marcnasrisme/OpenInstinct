import { describe, expect, it } from "vitest";
import type { Approval } from "eve/tools/approval";
import { calendarCreateEvent } from "@agent/tools/calendar";
import { gmailSend } from "@agent/tools/gmail";
import { toolContextFor } from "@tests/helpers/tool-context";

const email = {
  bcc: [],
  body: "Running ten minutes late.",
  cc: ["carol@example.com"],
  subject: "Late",
  to: ["bob@example.com"],
};
const event = {
  attendees: ["bob@example.com"],
  calendarId: "primary",
  end: "2099-09-15T14:30:00-04:00",
  start: "2099-09-15T14:00:00-04:00",
  summary: "Planning",
  timezone: "America/New_York",
};

describe("approval-gated root tools", () => {
  it("always asks before sending email and shows the exact message", async () => {
    const approval = approvalConfiguration(gmailSend.approval);

    expect(await approval.request(approvalContext("gmail-send", email))).toBe(
      "user-approval"
    );
    expect(await approval.request(approvalContext("gmail-send"))).toBe(
      "user-approval"
    );
    expect(approval.prompt?.(promptContext("gmail-send", email))).toBe(
      [
        "Send this email?",
        "To: bob@example.com",
        "Cc: carol@example.com",
        "Subject: Late",
        "",
        "Running ten minutes late.",
      ].join("\n")
    );
  });

  it("truncates a long body in the email prompt and states its length", () => {
    const approval = approvalConfiguration(gmailSend.approval);
    const body = "x".repeat(1_000);

    const prompt = approval.prompt?.(
      promptContext("gmail-send", { ...email, body })
    );

    expect(prompt).toContain(`${"x".repeat(600)}… (1000 characters in total)`);
    expect(prompt).not.toContain("x".repeat(601));
  });

  it("asks before a calendar event invites attendees", async () => {
    const approval = approvalConfiguration(calendarCreateEvent.approval);

    expect(
      await approval.request(approvalContext("calendar-create-event", event))
    ).toBe("user-approval");
    expect(
      await approval.request(
        approvalContext("calendar-create-event", { ...event, attendees: [] })
      )
    ).toBe("not-applicable");
    expect(
      await approval.request(approvalContext("calendar-create-event"))
    ).toBe("user-approval");
    expect(
      approval.prompt?.(promptContext("calendar-create-event", event))
    ).toBe(
      [
        "Create this event and email the invitations?",
        "Title: Planning",
        "When: 2099-09-15T14:00:00-04:00 to 2099-09-15T14:30:00-04:00 (America/New_York)",
        "Attendees: bob@example.com",
      ].join("\n")
    );
  });
});

function approvalConfiguration<TInput>(approval: Approval<TInput> | undefined) {
  if (!approval || !("request" in approval)) {
    throw new Error("Expected an approval configuration with a prompt.");
  }
  return approval;
}

function approvalContext<TInput>(toolName: string, toolInput?: TInput) {
  return { ...toolContextFor({ toolName }), toolInput };
}

function promptContext<TInput>(toolName: string, input: TInput) {
  return { callId: "call-1", input, toolName };
}

describe("approval prompt integrity", () => {
  it("keeps a line break in the subject from faking another header", () => {
    const approval = approvalConfiguration(gmailSend.approval);

    const prompt = approval.prompt?.(
      promptContext("gmail-send", {
        ...email,
        subject: "Late\nTo: bob@example.com",
      })
    );

    expect(prompt).toContain("Subject: Late To: bob@example.com");
    expect(
      prompt?.split("\n").filter((line) => line.startsWith("To:"))
    ).toEqual(["To: bob@example.com"]);
  });
});
