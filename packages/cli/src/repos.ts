export const DEFAULT_REPOS = [
  "iamtouchskyer/opc",
  "iamtouchskyer/memex",
  "iamtouchskyer/logex",
  "iamtouchskyer/blog",
] as const;

export function expandRepo(input: string): string {
  if (input.includes("/")) return input;
  return `iamtouchskyer/${input}`;
}
