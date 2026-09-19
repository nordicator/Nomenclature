import { Suspense } from "react";
import { Nomenclature } from "@/components/nomenclature";

export default function Page() {
  return (
    <Suspense>
      <Nomenclature />
    </Suspense>
  );
}
