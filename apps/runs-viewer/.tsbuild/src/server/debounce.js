export function debounce(fn, waitMs) {
    let timer = null;
    let lastArgs = null;
    return (...args) => {
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
            }
            else {
                fn(...args);
            }
        }, Math.max(0, waitMs));
    };
}
