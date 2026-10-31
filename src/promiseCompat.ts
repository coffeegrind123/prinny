// matrix-js-sdk calls Promise.withResolvers (Chrome 119+). The build targets
// esnext without polyfills and Android's minSdk is 24, so an Android System
// WebView older than 119 would throw on the first SDK call. Imported first
// in index.tsx so it runs before any module that touches the SDK.
type PromiseResolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseConstructorWithResolvers = {
  withResolvers?: <T>() => PromiseResolvers<T>;
};

const promiseConstructor = Promise as unknown as PromiseConstructorWithResolvers;

if (!promiseConstructor.withResolvers) {
  promiseConstructor.withResolvers = <T>(): PromiseResolvers<T> => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};
