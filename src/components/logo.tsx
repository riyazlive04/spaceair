import Image from "next/image";
import { cn } from "@/lib/format";

/**
 * Official SPACEAIR logo (from spaceair.in). The source file is 137×47 px, so it is shown at or near native size.
 * Replace public/brand/spaceair-logo.png with a vector/high-res master when SPACEAIR provides one.
 */
export function Logo({ height = 40, className, product = true }: { height?: number; className?: string; product?: boolean }) {
  const width = Math.round((height * 137) / 47);
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="logo-plate inline-flex">
        <Image src="/brand/spaceair-logo.png" alt="SPACEAIR – Feel the Difference" width={width} height={height} priority unoptimized />
      </span>
      {product && <span className="h-display rounded bg-accent px-1.5 py-0.5 text-[11px] tracking-[0.08em] text-accent-ink">CRM</span>}
    </span>
  );
}
