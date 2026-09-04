export function isEventTargetWithin(
  container: Node | null,
  target: EventTarget | null,
): boolean {
  return (
    typeof Node !== "undefined" &&
    target instanceof Node &&
    container?.contains(target) === true
  );
}
