export type ReplaceCallback<R> = (
  match: RegExpExecArray | RegExpMatchArray,
  pushIndex: number,
) => R;
export type ConvertPartCallback<R> = (text: string, pushIndex: number) => R;

export const findAndReplace = <ReplaceReturnType, ConvertReturnType>(
  text: string,
  regex: RegExp,
  replace: ReplaceCallback<ReplaceReturnType>,
  convertPart: ConvertPartCallback<ConvertReturnType>,
): Array<ReplaceReturnType | ConvertReturnType> => {
  const result: Array<ReplaceReturnType | ConvertReturnType> = [];
  let lastEnd = 0;

  let match: RegExpExecArray | RegExpMatchArray | null = regex.exec(text);
  while (match !== null && typeof match.index === 'number') {
    result.push(convertPart(text.slice(lastEnd, match.index), result.length));
    result.push(replace(match, result.length));

    lastEnd = match.index + match[0].length;
    if (!regex.global) break;
    // A zero-length match leaves `lastIndex` where it is, so the next `exec`
    // returns the same empty match at the same position forever — an unkillable
    // loop that also grows `result` without bound. Any regex built from
    // caller-supplied alternatives can produce one (an empty search term is
    // enough), so the guard belongs here rather than at each call site.
    if (match[0].length === 0) regex.lastIndex += 1;
    match = regex.exec(text);
  }

  result.push(convertPart(text.slice(lastEnd), result.length));

  return result;
};
