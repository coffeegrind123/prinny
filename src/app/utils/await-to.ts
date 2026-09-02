/**
 * Settle a promise into a `[error, value]` tuple instead of throwing, so a
 * caller can handle failure without wrapping every call in try/catch.
 *
 * This replaces the `await-to-js` package, whose entire implementation was
 * these few lines. The signature is deliberately identical to that package's,
 * including the `U = Error` parameter and the `[U, undefined] | [null, T]`
 * union return: the union is what lets TypeScript narrow `value` to `T` once
 * `error` is checked, so call sites keep the inference they already relied on.
 *
 * The dropped feature is `await-to-js`'s second `errorExt` argument, which
 * mutates the caught error with extra fields. Nothing here ever passed it.
 */
export function to<T, U = Error>(promise: Promise<T>): Promise<[U, undefined] | [null, T]> {
  return promise
    .then<[null, T]>((value: T) => [null, value])
    .catch<[U, undefined]>((err: U) => [err, undefined]);
}

export default to;
