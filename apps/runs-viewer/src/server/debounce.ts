export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  waitMs: number,
): (...args: TArgs) => void {
  let timer: NodeJS.Timeout | null = null;
  let lastArgs: TArgs | null = null;

  return (...args: TArgs) => {
    lastArgs = args;
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      const toCall = lastArgs;
      lastArgs = null;
      if (toCall) {
        fn(...toCall);
      } else {
        fn(...args);
      }
    }, Math.max(0, waitMs));
  };
}

