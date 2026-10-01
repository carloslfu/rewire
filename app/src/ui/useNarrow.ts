import { useEffect, useState } from "react";

export function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 900px)").matches);
  useEffect(() => {
    const query = matchMedia("(max-width: 900px)");
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}
