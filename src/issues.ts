import type { ZodError } from "zod/v4";

/** Each issue of a Zod error as `path: message`; an issue on the value itself is named `root` ("(input)", "(root)"). */
export function issueLines(error: ZodError, root = "(input)"): string[] {
  return error.issues.map((i) => `${i.path.join(".") || root}: ${i.message}`);
}

/** The issues on one line, `; `-separated: the form a tool's refusal quotes. */
export function issueText(error: ZodError, root = "(input)"): string {
  return issueLines(error, root).join("; ");
}
