import { useReducer, useRef, useState } from "react";

export function BoundedLocalState() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [isExpanded, setExpanded] = useState(false);
  const [version, bumpVersion] = useReducer((value: number) => value + 1, 0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section>
      <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} />
      <button onClick={() => setPage(page + 1)}>{page}</button>
      <button onClick={() => setExpanded(!isExpanded)}>{String(isExpanded)}</button>
      <button onClick={bumpVersion}>{version}</button>
    </section>
  );
}
