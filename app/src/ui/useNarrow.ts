import { useEffect, useState } from "react";

// Phone landscape should keep the same navigation as portrait.
const mobileQuery = "(max-width: 900px), (max-width: 1100px) and (max-height: 500px)";

export function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia(mobileQuery).matches);
  useEffect(() => {
    const query = matchMedia(mobileQuery);
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}
