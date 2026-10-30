let curId: number = 0;

export function getId() {
  if (curId === Number.MAX_SAFE_INTEGER) {
    throw new Error("The maximum value limit has been exceeded")
  }
  return ++curId;
}
