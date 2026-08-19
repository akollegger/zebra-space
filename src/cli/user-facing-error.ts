/**
 * An error whose message is the *entire* intended output.
 *
 * Stricli reports a failed command by printing the thrown error's `stack`, which for an ordinary
 * `Error` means a JS stack trace pointing into `effect`'s internals gets appended to whatever
 * message we carefully wrote. For an *expected* failure — a rejected extraction, an unreachable
 * provider, a model that ignored the schema — that trace is noise that buries the actionable
 * part, and spec.md SC-003 explicitly wants the reported message alone to explain the problem
 * "without needing to inspect internal logs or source code".
 *
 * Overriding `stack` with the message makes the printed form exactly the message. Reserved for
 * failures we have deliberately explained; a genuine bug should still surface its real trace.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UserFacingError"
    this.stack = message
  }
}
