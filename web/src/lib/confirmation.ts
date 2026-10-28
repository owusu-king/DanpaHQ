/** Exact, case-sensitive acknowledgement. Empty names never confirm deletion. */
export function confirmsExactly(value: string, expected: string): boolean {
  return expected.length > 0 && value === expected;
}
