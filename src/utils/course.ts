export function computeIsBlended(
  deliveryModeNames: (string | null | undefined)[] = [],
): boolean {
  const names = deliveryModeNames.map((n) => n?.toLowerCase() ?? "");
  if (names.includes("hybrid") || names.includes("blended")) return true;
  return (
    names.includes("online") &&
    (names.includes("in-person") || names.includes("in person"))
  );
}
